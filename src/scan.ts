/**
 * Import-specifier extraction. A small hand-rolled scanner walks the file
 * once, skipping comments, string literals, template literals (including
 * nested `${}` expressions) and regex literals, and records every module
 * specifier it finds in the four syntactic forms that matter:
 *
 *   import … from "spec"     import "spec"     import type … from "spec"
 *   export … from "spec"     export type … from "spec"
 *   import("spec")           (only literal arguments)
 *   require("spec")          (only literal arguments)
 *
 * No AST, no dependency on the TypeScript compiler API: the scanner only
 * needs to be right about where strings and comments are, which is a far
 * smaller problem than parsing, and it stays fast on large trees.
 */

import type { ImportKind, ImportRef } from "./types.js";

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[A-Za-z0-9_$]/;

/**
 * Tokens after which a `/` must be a regex literal rather than division.
 * Tracking the previous significant token is the classic heuristic used by
 * every JS lexer; it is exact for real-world code.
 */
const REGEX_PRECEDERS = new Set([
  "(", ",", "=", ":", "[", "!", "&", "|", "?", "{", "}", ";", "=>",
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
  "throw", "case", "do", "else", "yield", "await",
]);

interface Cursor {
  src: string;
  pos: number;
  line: number;
  /** Last significant token seen (identifier text or single punctuator). */
  prev: string;
}

/** Extracts every statically-knowable module specifier from `src`. */
export function extractImports(src: string): ImportRef[] {
  const refs: ImportRef[] = [];
  const c: Cursor = { src, pos: 0, line: 1, prev: ";" };
  const n = src.length;

  while (c.pos < n) {
    const ch = src[c.pos]!;

    if (ch === "\n") {
      c.line++;
      c.pos++;
      continue;
    }
    if (ch === "/" && src[c.pos + 1] === "/") {
      skipLineComment(c);
      continue;
    }
    if (ch === "/" && src[c.pos + 1] === "*") {
      skipBlockComment(c);
      continue;
    }
    if (ch === '"' || ch === "'") {
      skipString(c, ch);
      c.prev = "string";
      continue;
    }
    if (ch === "`") {
      skipTemplate(c, refs);
      c.prev = "string";
      continue;
    }
    if (ch === "/" && REGEX_PRECEDERS.has(c.prev)) {
      skipRegex(c);
      c.prev = "regex";
      continue;
    }
    if (IDENT_START.test(ch)) {
      const word = readIdent(c);
      handleKeyword(c, word, refs);
      c.prev = word;
      continue;
    }
    if (ch === "=" && src[c.pos + 1] === ">") {
      c.prev = "=>";
      c.pos += 2;
      continue;
    }
    if (!/\s/.test(ch)) c.prev = ch;
    c.pos++;
  }
  return refs;
}

function skipLineComment(c: Cursor): void {
  while (c.pos < c.src.length && c.src[c.pos] !== "\n") c.pos++;
}

function skipBlockComment(c: Cursor): void {
  c.pos += 2;
  while (c.pos < c.src.length) {
    if (c.src[c.pos] === "\n") c.line++;
    if (c.src[c.pos] === "*" && c.src[c.pos + 1] === "/") {
      c.pos += 2;
      return;
    }
    c.pos++;
  }
}

function skipString(c: Cursor, quote: string): void {
  c.pos++;
  while (c.pos < c.src.length) {
    const ch = c.src[c.pos]!;
    if (ch === "\\") {
      if (c.src[c.pos + 1] === "\n") c.line++;
      c.pos += 2;
      continue;
    }
    if (ch === "\n") {
      // Unterminated string (or a stray quote inside odd input): stop at
      // the line break rather than swallowing the rest of the file.
      return;
    }
    c.pos++;
    if (ch === quote) return;
  }
}

/**
 * Skips a template literal. `${…}` expressions can themselves contain
 * imports (rare, but `await import(…)` inside a template happens in
 * generated code), so expression bodies are re-scanned recursively via the
 * main loop by tracking brace depth here.
 */
function skipTemplate(c: Cursor, refs: ImportRef[]): void {
  c.pos++; // opening backtick
  while (c.pos < c.src.length) {
    const ch = c.src[c.pos]!;
    if (ch === "\\") {
      c.pos += 2;
      continue;
    }
    if (ch === "\n") {
      c.line++;
      c.pos++;
      continue;
    }
    if (ch === "`") {
      c.pos++;
      return;
    }
    if (ch === "$" && c.src[c.pos + 1] === "{") {
      c.pos += 2;
      skipTemplateExpression(c, refs);
      continue;
    }
    c.pos++;
  }
}

/** Scans a `${…}` body, honoring nested strings/templates/braces. */
function skipTemplateExpression(c: Cursor, refs: ImportRef[]): void {
  let depth = 1;
  c.prev = "{";
  while (c.pos < c.src.length && depth > 0) {
    const ch = c.src[c.pos]!;
    if (ch === "\n") {
      c.line++;
      c.pos++;
      continue;
    }
    if (ch === "/" && c.src[c.pos + 1] === "/") {
      skipLineComment(c);
      continue;
    }
    if (ch === "/" && c.src[c.pos + 1] === "*") {
      skipBlockComment(c);
      continue;
    }
    if (ch === '"' || ch === "'") {
      skipString(c, ch);
      c.prev = "string";
      continue;
    }
    if (ch === "`") {
      skipTemplate(c, refs);
      c.prev = "string";
      continue;
    }
    if (IDENT_START.test(ch)) {
      const word = readIdent(c);
      handleKeyword(c, word, refs);
      c.prev = word;
      continue;
    }
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (!/\s/.test(ch)) c.prev = ch;
    c.pos++;
  }
}

function skipRegex(c: Cursor): void {
  c.pos++; // opening slash
  let inClass = false;
  while (c.pos < c.src.length) {
    const ch = c.src[c.pos]!;
    if (ch === "\\") {
      c.pos += 2;
      continue;
    }
    if (ch === "\n") return; // not actually a regex; bail safely
    if (ch === "[") inClass = true;
    else if (ch === "]") inClass = false;
    else if (ch === "/" && !inClass) {
      c.pos++;
      while (c.pos < c.src.length && IDENT_PART.test(c.src[c.pos]!)) c.pos++; // flags
      return;
    }
    c.pos++;
  }
}

function readIdent(c: Cursor): string {
  const start = c.pos;
  while (c.pos < c.src.length && IDENT_PART.test(c.src[c.pos]!)) c.pos++;
  return c.src.slice(start, c.pos);
}

/** Dispatches on `import` / `export` / `require` keywords. */
function handleKeyword(c: Cursor, word: string, refs: ImportRef[]): void {
  if (word === "import") {
    // Property access like `foo.import` is not a keyword use.
    if (lastNonSpaceBefore(c, c.pos - word.length) === ".") return;
    scanAfterImport(c, refs);
  } else if (word === "export") {
    if (lastNonSpaceBefore(c, c.pos - word.length) === ".") return;
    scanExportFrom(c, refs);
  } else if (word === "require") {
    if (lastNonSpaceBefore(c, c.pos - word.length) === ".") return;
    scanCallArgument(c, refs, "require");
  }
}

function lastNonSpaceBefore(c: Cursor, index: number): string {
  for (let i = index - 1; i >= 0; i--) {
    const ch = c.src[i]!;
    if (!/\s/.test(ch)) return ch;
  }
  return "";
}

/**
 * After the `import` keyword: either `import("spec")` (dynamic),
 * `import "spec"` (bare side-effect import), or a clause followed by
 * `from "spec"`. `import.meta` is ignored.
 */
function scanAfterImport(c: Cursor, refs: ImportRef[]): void {
  const save = snapshot(c);
  skipTrivia(c);
  const ch = c.src[c.pos];
  if (ch === "(") {
    restore(c, save);
    scanCallArgument(c, refs, "dynamic-import");
    return;
  }
  if (ch === ".") return; // import.meta
  if (ch === '"' || ch === "'") {
    const line = c.line;
    const spec = readStringLiteral(c);
    if (spec !== undefined) {
      refs.push({ specifier: spec, kind: "import", line, typeOnly: false });
    }
    return;
  }
  scanClauseThenFrom(c, refs, "import");
}

/** After `export`: only `export … from "spec"` produces an edge. */
function scanExportFrom(c: Cursor, refs: ImportRef[]): void {
  scanClauseThenFrom(c, refs, "export-from");
}

/**
 * Skips an import/export clause — identifiers, braces, commas, `* as ns` —
 * until `from "spec"`, a semicolon, or something that proves this is not a
 * module declaration (e.g. `export const x = 1`). Notes `type` for
 * type-only edges.
 */
function scanClauseThenFrom(
  c: Cursor,
  refs: ImportRef[],
  kind: ImportKind,
): void {
  const save = snapshot(c);
  let typeOnly = false;
  let first = true;
  let braceDepth = 0;

  for (;;) {
    skipTrivia(c);
    if (c.pos >= c.src.length) break;
    const ch = c.src[c.pos]!;

    if (ch === "{") {
      braceDepth++;
      c.pos++;
      continue;
    }
    if (ch === "}") {
      if (braceDepth === 0) break;
      braceDepth--;
      c.pos++;
      continue;
    }
    if (ch === "*" || ch === ",") {
      c.pos++;
      continue;
    }
    if (ch === '"' || ch === "'") break; // e.g. `import "x"` already handled
    if (ch === ";" || ch === "(" || ch === "=" || ch === ":") break;

    if (IDENT_START.test(ch)) {
      const word = readIdent(c);
      if (word === "from" && braceDepth === 0) {
        skipTrivia(c);
        const q = c.src[c.pos];
        if (q === '"' || q === "'") {
          const line = c.line;
          const spec = readStringLiteral(c);
          if (spec !== undefined) refs.push({ specifier: spec, kind, line, typeOnly });
        }
        return;
      }
      // Only the statement-level keyword (`import type …`, `export type …`)
      // makes the edge type-only. Inline specifiers (`import { type T, v }`)
      // may sit next to value bindings, so the edge must stay a value edge.
      if (word === "type" && first && braceDepth === 0) typeOnly = true;
      // `export default function…`, `export class…` etc: not a re-export.
      if (
        braceDepth === 0 &&
        ["function", "class", "const", "let", "var", "enum", "abstract",
          "interface", "namespace", "declare", "async"].includes(word)
      ) {
        restore(c, save);
        return;
      }
      first = false;
      continue;
    }
    break;
  }
  restore(c, save);
}

/** Handles `import(…)` and `require(…)` with a single literal argument. */
function scanCallArgument(
  c: Cursor,
  refs: ImportRef[],
  kind: "dynamic-import" | "require",
): void {
  const save = snapshot(c);
  skipTrivia(c);
  if (c.src[c.pos] !== "(") {
    restore(c, save);
    return;
  }
  c.pos++;
  skipTrivia(c);
  const q = c.src[c.pos];
  if (q !== '"' && q !== "'") {
    // Non-literal argument (`import(variable)`): unknowable statically.
    restore(c, save);
    return;
  }
  const line = c.line;
  const spec = readStringLiteral(c);
  if (spec === undefined) {
    restore(c, save);
    return;
  }
  skipTrivia(c);
  if (c.src[c.pos] === ")" || c.src[c.pos] === ",") {
    refs.push({ specifier: spec, kind, line, typeOnly: false });
  }
}

/** Reads a quoted literal at the cursor; undefined if malformed. */
function readStringLiteral(c: Cursor): string | undefined {
  const quote = c.src[c.pos]!;
  c.pos++;
  let out = "";
  while (c.pos < c.src.length) {
    const ch = c.src[c.pos]!;
    if (ch === "\\") {
      out += c.src[c.pos + 1] ?? "";
      c.pos += 2;
      continue;
    }
    if (ch === "\n") return undefined;
    c.pos++;
    if (ch === quote) return out;
    out += ch;
  }
  return undefined;
}

function skipTrivia(c: Cursor): void {
  for (;;) {
    const ch = c.src[c.pos];
    if (ch === "\n") {
      c.line++;
      c.pos++;
    } else if (ch !== undefined && /\s/.test(ch)) {
      c.pos++;
    } else if (ch === "/" && c.src[c.pos + 1] === "/") {
      skipLineComment(c);
    } else if (ch === "/" && c.src[c.pos + 1] === "*") {
      skipBlockComment(c);
    } else {
      return;
    }
  }
}

interface Snapshot {
  pos: number;
  line: number;
}

function snapshot(c: Cursor): Snapshot {
  return { pos: c.pos, line: c.line };
}

function restore(c: Cursor, s: Snapshot): void {
  c.pos = s.pos;
  c.line = s.line;
}
