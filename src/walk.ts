/**
 * Project file discovery. A plain recursive walk that skips the directory
 * names every JS/TS repo wants skipped (dependencies, build output, VCS
 * metadata) plus any user-supplied extras, and collects files whose
 * extension marks them as analyzable source. Deterministic: entries are
 * sorted before descent so results are byte-stable across filesystems.
 */

import { join } from "node:path";
import { SOURCE_EXTENSIONS } from "./resolve.js";
import type { FsHost } from "./types.js";

/** Directory names never worth descending into. */
export const DEFAULT_IGNORE_DIRS = [
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  ".nuxt",
  ".turbo",
  ".cache",
  "vendor",
] as const;

const SOURCE_EXT_SET = new Set<string>(SOURCE_EXTENSIONS);

/**
 * Returns absolute paths of every source file under `root`, sorted.
 * `extraIgnores` adds directory names (not globs) to the skip list.
 */
export function walkProject(
  root: string,
  host: FsHost,
  extraIgnores: string[] = [],
): string[] {
  const ignore = new Set<string>([...DEFAULT_IGNORE_DIRS, ...extraIgnores]);
  const files: string[] = [];
  walkDir(root, host, ignore, files);
  files.sort();
  return files;
}

function walkDir(
  dir: string,
  host: FsHost,
  ignore: Set<string>,
  files: string[],
): void {
  const entries = host
    .readDir(dir)
    .slice()
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) {
    if (entry.isDirectory) {
      if (ignore.has(entry.name)) continue;
      walkDir(join(dir, entry.name), host, ignore, files);
    } else if (isSourceFile(entry.name)) {
      files.push(join(dir, entry.name));
    }
  }
}

/** True when the filename carries an analyzable source extension. */
export function isSourceFile(name: string): boolean {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return false;
  const ext = name.slice(dot);
  if (!SOURCE_EXT_SET.has(ext)) return false;
  // `.d.ts` declaration files describe modules but contain no runtime
  // code; they still re-export types, so they stay in the graph.
  return true;
}
