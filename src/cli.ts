#!/usr/bin/env node
/**
 * CLI entry point. Wires argument parsing, git diff discovery, the pure
 * analysis pipeline, and rendering. All process concerns (exit codes,
 * stream selection) live here and nowhere else.
 */

import { resolve } from "node:path";
import { CliOptions, HELP_TEXT, parseArgs, UsageError } from "./cliargs.js";
import { changedFilesFromGit, GitError } from "./gitdiff.js";
import { createNodeHost } from "./host.js";
import { renderReport, renderWhy } from "./report.js";
import { computeRipple } from "./ripple.js";
import { DEFAULT_RUN_ALL_PATTERNS, DEFAULT_TEST_PATTERNS } from "./testmatch.js";
import { VERSION } from "./version.js";

export function main(argv: string[]): number {
  let opts: CliOptions;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`testripple: ${err.message}\n`);
      process.stderr.write(`try: testripple --help\n`);
      return 2;
    }
    throw err;
  }

  if (opts.help) {
    process.stdout.write(HELP_TEXT);
    return 0;
  }
  if (opts.version) {
    process.stdout.write(`testripple ${VERSION}\n`);
    return 0;
  }

  const cwd = process.cwd();
  let root = resolve(cwd, opts.root ?? ".");
  let changed: string[];

  try {
    if (opts.files.length > 0) {
      changed = opts.files.map((f) => resolve(cwd, f));
    } else {
      const diff = changedFilesFromGit({
        cwd: root,
        base: opts.base,
        staged: opts.staged,
      });
      changed = diff.files;
      // Anchor the analysis at the repo root unless --root overrode it,
      // so paths in output are stable regardless of invocation directory.
      if (opts.root === undefined) root = diff.repoRoot;
    }
  } catch (err) {
    if (err instanceof GitError) {
      process.stderr.write(`testripple: ${err.message}\n`);
      process.stderr.write(
        `hint: outside a git repository, pass --files <paths>\n`,
      );
      return 3;
    }
    throw err;
  }

  const result = computeRipple(
    {
      root,
      changed,
      testPatterns:
        opts.testPatterns.length > 0 ? opts.testPatterns : [...DEFAULT_TEST_PATTERNS],
      runAllPatterns:
        opts.runAllPatterns.length > 0
          ? opts.runAllPatterns
          : [...DEFAULT_RUN_ALL_PATTERNS],
      ignoreDirs: opts.ignoreDirs,
      tsconfigPath: opts.tsconfigPath,
      skipTypeOnly: opts.skipTypeOnly,
    },
    createNodeHost(),
  );

  if (opts.why !== undefined) {
    const why = renderWhy(result, root, opts.why);
    process.stdout.write(why.text);
    return why.found ? 0 : 1;
  }

  const report = renderReport(result, root, opts.format, opts.quiet);
  process.stdout.write(report.stdout);
  process.stderr.write(report.stderr);

  if (
    opts.failOnUnresolved &&
    result.diagnostics.some((d) => d.message.startsWith("unresolved import"))
  ) {
    process.stderr.write(`testripple: unresolved imports present (--fail-on-unresolved)\n`);
    return 1;
  }
  return 0;
}

process.exitCode = main(process.argv.slice(2));
