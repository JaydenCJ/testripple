// Minimal glob matching — exactly the subset test-pattern configs need:
//
//   *        any run of characters within one path segment
//   ?        one character within a segment
//   **       any number of whole segments (including zero)
//   {a,b}    alternation (no nesting)
//
// Patterns match against `/`-separated paths relative to the project
// root. A pattern with no slash matches against the basename in any
// directory (the familiar `.gitignore` convenience), so `*.spec.ts`
// behaves like `**/*.spec.ts`.

const REGEX_SPECIALS = /[.+^$()|[\]\\]/g;

/** Compiles one glob into an anchored RegExp. Throws on unbalanced `{`. */
export function globToRegExp(glob: string): RegExp {
  let pattern = glob;
  if (!pattern.includes("/")) pattern = "**/" + pattern;
  if (pattern.startsWith("./")) pattern = pattern.slice(2);

  let out = "";
  let i = 0;
  const n = pattern.length;
  while (i < n) {
    const ch = pattern[i]!;
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        // `**/` (or trailing `**`) spans zero or more segments.
        if (pattern[i + 2] === "/") {
          out += "(?:[^/]+/)*";
          i += 3;
        } else {
          out += ".*";
          i += 2;
        }
      } else {
        out += "[^/]*";
        i++;
      }
      continue;
    }
    if (ch === "?") {
      out += "[^/]";
      i++;
      continue;
    }
    if (ch === "{") {
      const close = pattern.indexOf("}", i);
      if (close < 0) throw new Error(`unbalanced '{' in glob: ${glob}`);
      const body = pattern.slice(i + 1, close);
      const parts = body
        .split(",")
        .map((p) => p.replace(REGEX_SPECIALS, "\\$&").replace(/\*/g, "[^/]*"));
      out += "(?:" + parts.join("|") + ")";
      i = close + 1;
      continue;
    }
    out += ch.replace(REGEX_SPECIALS, "\\$&");
    i++;
  }
  return new RegExp("^" + out + "$");
}

/** A compiled set of globs with a single `matches` entry point. */
export class GlobSet {
  private readonly regexps: RegExp[];
  constructor(globs: string[]) {
    this.regexps = globs.map(globToRegExp);
  }
  /** `relPath` must be `/`-separated and root-relative. */
  matches(relPath: string): boolean {
    return this.regexps.some((r) => r.test(relPath));
  }
}
