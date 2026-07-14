/**
 * Tolerant JSON parsing for tsconfig.json files, which routinely contain
 * `//` and slash-star comments plus trailing commas. The strategy is to
 * rewrite comments to spaces (preserving offsets and newlines so JSON.parse
 * error positions stay meaningful), drop trailing commas, then hand the
 * result to the native parser. String contents are never touched.
 */

/** Parses JSON-with-comments-and-trailing-commas. Throws on real errors. */
export function parseJsonc(text: string): unknown {
  return JSON.parse(stripJsonc(text));
}

/** Returns strict JSON: comments blanked, trailing commas removed. */
export function stripJsonc(text: string): string {
  const out: string[] = [];
  let i = 0;
  const n = text.length;

  while (i < n) {
    const ch = text[i]!;

    if (ch === '"') {
      // Copy the string verbatim, honoring escapes.
      out.push(ch);
      i++;
      while (i < n) {
        const s = text[i]!;
        out.push(s);
        i++;
        if (s === "\\") {
          if (i < n) {
            out.push(text[i]!);
            i++;
          }
          continue;
        }
        if (s === '"') break;
      }
      continue;
    }

    if (ch === "/" && text[i + 1] === "/") {
      while (i < n && text[i] !== "\n") {
        out.push(" ");
        i++;
      }
      continue;
    }

    if (ch === "/" && text[i + 1] === "*") {
      out.push("  ");
      i += 2;
      while (i < n && !(text[i] === "*" && text[i + 1] === "/")) {
        out.push(text[i] === "\n" ? "\n" : " ");
        i++;
      }
      if (i < n) {
        out.push("  ");
        i += 2;
      }
      continue;
    }

    if (ch === ",") {
      // A trailing comma is one whose next significant character closes a
      // container. Look ahead through whitespace and comments.
      let j = i + 1;
      for (;;) {
        while (j < n && /\s/.test(text[j]!)) j++;
        if (text[j] === "/" && text[j + 1] === "/") {
          while (j < n && text[j] !== "\n") j++;
          continue;
        }
        if (text[j] === "/" && text[j + 1] === "*") {
          j += 2;
          while (j < n && !(text[j] === "*" && text[j + 1] === "/")) j++;
          j += 2;
          continue;
        }
        break;
      }
      if (text[j] === "}" || text[j] === "]") {
        out.push(" "); // drop the comma, keep offsets
        i++;
        continue;
      }
    }

    out.push(ch);
    i++;
  }
  return out.join("");
}
