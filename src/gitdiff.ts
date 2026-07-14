/**
 * Changed-file discovery via the local `git` binary. This is the only
 * module in the codebase that starts a subprocess, and the only external
 * program testripple ever talks to. Everything is NUL-delimited
 * (`-z` / `ls-files -z`) so exotic filenames survive intact.
 */

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

export interface DiffOptions {
  /** Directory inside the repository to run git in. */
  cwd: string;
  /**
   * Diff base. `undefined` = working tree + index vs HEAD, plus untracked
   * files — "what have I touched since my last commit".
   */
  base?: string;
  /** Compare the index only (`git diff --cached`). */
  staged?: boolean;
}

export interface DiffResult {
  /** Absolute paths of changed files (may include deleted ones). */
  files: string[];
  /** Absolute repository root reported by git. */
  repoRoot: string;
}

/** Raised for any git failure, with the underlying stderr attached. */
export class GitError extends Error {}

export function changedFilesFromGit(opts: DiffOptions): DiffResult {
  const repoRoot = git(opts.cwd, ["rev-parse", "--show-toplevel"]).trim();

  const files = new Set<string>();
  if (opts.staged) {
    collect(files, repoRoot, git(opts.cwd, ["diff", "--name-only", "-z", "--cached"]));
  } else if (opts.base !== undefined) {
    // Triple-dot: diff against the merge base, which is what "which tests
    // does my branch affect" means on a feature branch.
    collect(
      files,
      repoRoot,
      git(opts.cwd, ["diff", "--name-only", "-z", `${opts.base}...HEAD`]),
    );
    // Uncommitted work on top of the branch counts too.
    collect(files, repoRoot, git(opts.cwd, ["diff", "--name-only", "-z", "HEAD"]));
    collect(
      files,
      repoRoot,
      git(opts.cwd, ["ls-files", "--others", "--exclude-standard", "-z"]),
    );
  } else {
    collect(files, repoRoot, git(opts.cwd, ["diff", "--name-only", "-z", "HEAD"]));
    collect(
      files,
      repoRoot,
      git(opts.cwd, ["ls-files", "--others", "--exclude-standard", "-z"]),
    );
  }

  return { files: [...files].sort(), repoRoot };
}

function collect(into: Set<string>, repoRoot: string, zOutput: string): void {
  for (const rel of zOutput.split("\0")) {
    if (rel !== "") into.add(resolve(repoRoot, rel));
  }
}

/** Runs git, returning stdout; throws GitError with stderr context. */
function git(cwd: string, args: string[]): string {
  const proc = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (proc.error) {
    throw new GitError(`failed to run git: ${proc.error.message}`);
  }
  if (proc.status !== 0) {
    const detail = proc.stderr.trim().split("\n")[0] ?? "";
    throw new GitError(`git ${args[0]} failed: ${detail}`);
  }
  return proc.stdout;
}
