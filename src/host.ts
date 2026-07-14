/**
 * The real-filesystem FsHost, plus an in-memory implementation used by the
 * test suite (exported so downstream tooling can analyze virtual trees —
 * e.g. running impact analysis inside an editor buffer without saving).
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import type { FsHost } from "./types.js";

/** FsHost backed by node:fs, with a stat cache (resolution re-probes). */
export function createNodeHost(): FsHost {
  const statCache = new Map<string, "file" | "dir" | "none">();
  const kind = (path: string): "file" | "dir" | "none" => {
    const hit = statCache.get(path);
    if (hit !== undefined) return hit;
    const st = statSync(path, { throwIfNoEntry: false });
    const k = st === undefined ? "none" : st.isFile() ? "file" : st.isDirectory() ? "dir" : "none";
    statCache.set(path, k);
    return k;
  };
  return {
    isFile: (path) => kind(path) === "file",
    isDirectory: (path) => kind(path) === "dir",
    readFile: (path) => readFileSync(path, "utf8"),
    readDir: (path) => {
      try {
        return readdirSync(path, { withFileTypes: true }).map((d) => ({
          name: d.name,
          isDirectory: d.isDirectory(),
        }));
      } catch {
        return [];
      }
    },
  };
}

/**
 * In-memory FsHost over a `path → contents` map. Paths are normalized to
 * absolute POSIX form; intermediate directories are implied.
 */
export function createMemoryHost(files: Record<string, string>): FsHost {
  const store = new Map<string, string>();
  const dirs = new Set<string>();
  for (const [rawPath, contents] of Object.entries(files)) {
    const path = resolve(rawPath);
    store.set(path, contents);
    let dir = dirname(path);
    while (!dirs.has(dir)) {
      dirs.add(dir);
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return {
    isFile: (path) => store.has(resolve(path)),
    isDirectory: (path) => dirs.has(resolve(path)),
    readFile: (path) => {
      const hit = store.get(resolve(path));
      if (hit === undefined) throw new Error(`ENOENT: ${path}`);
      return hit;
    },
    readDir: (path) => {
      const abs = resolve(path);
      const prefix = abs === sep ? abs : abs + sep;
      const out = new Map<string, boolean>();
      for (const file of store.keys()) {
        if (!file.startsWith(prefix)) continue;
        const rest = file.slice(prefix.length);
        const slash = rest.indexOf(sep);
        if (slash < 0) out.set(rest, false);
        else out.set(rest.slice(0, slash), true);
      }
      return [...out.entries()].map(([name, isDirectory]) => ({ name, isDirectory }));
    },
  };
}
