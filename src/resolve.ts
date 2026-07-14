/**
 * Node-and-TypeScript-flavoured module resolution, static and offline.
 * Given a specifier written in some file, produce the absolute path of the
 * source file it refers to — or classify it as external (bare package /
 * node builtin) or unresolved. The resolver deliberately mirrors what
 * `tsc --moduleResolution bundler|nodenext` accepts in real projects:
 *
 *   ./util          → ./util.ts, ./util.tsx, ./util.js, … , ./util/index.*
 *   ./util.js       → ./util.js, plus ./util.ts (NodeNext source mapping)
 *   @app/thing      → tsconfig `paths` patterns, then `baseUrl` lookup
 *   node:fs, react  → external
 *
 * Every failed attempt records the candidate paths it tried; the graph
 * uses those candidates to attribute impact for *deleted* files, whose
 * importers now hold dangling specifiers.
 */

import { dirname, isAbsolute, join, normalize, resolve } from "node:path";
import type { FsHost, PathsConfig, Resolution } from "./types.js";

/** Extensions considered source, in resolution priority order. */
export const SOURCE_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
] as const;

/** Output-extension → source-extension candidates (NodeNext style). */
const EXTENSION_REMAP: Record<string, string[]> = {
  ".js": [".ts", ".tsx"],
  ".mjs": [".mts"],
  ".cjs": [".cts"],
  ".jsx": [".tsx"],
};

export interface Resolver {
  resolve(fromFile: string, specifier: string): Resolution;
}

export function createResolver(host: FsHost, config: PathsConfig): Resolver {
  return {
    resolve(fromFile: string, specifier: string): Resolution {
      return resolveSpecifier(host, config, fromFile, specifier);
    },
  };
}

function resolveSpecifier(
  host: FsHost,
  config: PathsConfig,
  fromFile: string,
  specifier: string,
): Resolution {
  // Strip query/hash suffixes some bundlers allow (`./a.css?inline`).
  const clean = specifier.replace(/[?#].*$/, "");
  if (clean === "") return { kind: "external", specifier };

  if (clean.startsWith("./") || clean.startsWith("../")) {
    const base = join(dirname(fromFile), clean);
    return tryFileCandidates(host, base, specifier);
  }

  if (isAbsolute(clean)) {
    return tryFileCandidates(host, normalize(clean), specifier);
  }

  // Bare specifier: try tsconfig paths first, then baseUrl, then external.
  const tried: string[] = [];
  const viaPaths = matchPaths(config, clean);
  for (const target of viaPaths) {
    const res = tryFileCandidates(host, target, specifier);
    if (res.kind === "file") return res;
    if (res.kind === "unresolved") tried.push(...res.tried);
  }

  if (config.baseUrl) {
    const res = tryFileCandidates(host, resolve(config.baseUrl, clean), specifier);
    if (res.kind === "file") return res;
    if (res.kind === "unresolved") tried.push(...res.tried);
  }

  if (viaPaths.length > 0) {
    // The specifier matched an alias pattern but no target file exists:
    // that is a broken alias, not an npm package. Report candidates so
    // deleted aliased files still propagate impact.
    return { kind: "unresolved", specifier, tried };
  }
  return { kind: "external", specifier };
}

/**
 * Expands tsconfig `paths` for a specifier. Exact patterns win over `*`
 * patterns; among `*` patterns the longest matched prefix wins (tsc rule).
 * Returns absolute target bases in priority order.
 */
export function matchPaths(config: PathsConfig, specifier: string): string[] {
  const patterns = Object.keys(config.paths);
  if (patterns.length === 0) return [];

  const exact = config.paths[specifier];
  if (exact) return exact;

  let best: { prefix: string; suffix: string; targets: string[] } | undefined;
  for (const pattern of patterns) {
    const star = pattern.indexOf("*");
    if (star < 0) continue;
    const prefix = pattern.slice(0, star);
    const suffix = pattern.slice(star + 1);
    if (
      specifier.length >= prefix.length + suffix.length &&
      specifier.startsWith(prefix) &&
      specifier.endsWith(suffix) &&
      (!best || prefix.length > best.prefix.length)
    ) {
      best = { prefix, suffix, targets: config.paths[pattern]! };
    }
  }
  if (!best) return [];

  const matched = specifier.slice(
    best.prefix.length,
    specifier.length - best.suffix.length,
  );
  return best.targets.map((t) => t.replace("*", matched));
}

/**
 * Given an extensionless-or-not base path, try the candidate set:
 *  1. the path exactly as written (if it has a known extension)
 *  2. source-extension remaps (`./x.js` written for `./x.ts` on disk)
 *  3. base + each source extension
 *  4. base as a directory: index.<ext>
 * Also accepts non-source assets (`./styles.css`) when the file exists —
 * an edit to an imported asset should ripple like any other change.
 */
function tryFileCandidates(
  host: FsHost,
  base: string,
  specifier: string,
): Resolution {
  const tried: string[] = [];
  const probe = (p: string): boolean => {
    tried.push(p);
    return host.isFile(p);
  };

  const ext = extensionOf(base);
  const knownExt = (SOURCE_EXTENSIONS as readonly string[]).includes(ext);
  if (ext !== "") {
    if (probe(base)) return { kind: "file", path: base };
    const stem = base.slice(0, base.length - ext.length);
    for (const mapped of EXTENSION_REMAP[ext] ?? []) {
      if (probe(stem + mapped)) return { kind: "file", path: stem + mapped };
    }
    // `./data.json` style assets stop here; only odd names like `./v1.2`
    // (where ".2" is not a real extension) go on to extension probing.
  }
  if (!knownExt) {
    for (const e of SOURCE_EXTENSIONS) {
      if (probe(base + e)) return { kind: "file", path: base + e };
    }
  }
  if (host.isDirectory(base)) {
    for (const e of SOURCE_EXTENSIONS) {
      const idx = join(base, "index" + e);
      if (probe(idx)) return { kind: "file", path: idx };
    }
  }
  return { kind: "unresolved", specifier, tried };
}

/** The final `.ext` of a path's basename ("" when none). */
function extensionOf(p: string): string {
  const slash = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  const dot = p.lastIndexOf(".");
  return dot > slash + 1 ? p.slice(dot) : "";
}
