/**
 * Argument parsing for the CLI. Hand-rolled on purpose: the surface is
 * small, error messages should name the flag exactly, and a parser
 * dependency would be the project's only runtime dependency.
 */

export interface CliOptions {
  root?: string;
  base?: string;
  staged: boolean;
  files: string[];
  testPatterns: string[];
  runAllPatterns: string[];
  ignoreDirs: string[];
  tsconfigPath?: string;
  format: "list" | "json" | "null";
  why?: string;
  skipTypeOnly: boolean;
  quiet: boolean;
  failOnUnresolved: boolean;
  help: boolean;
  version: boolean;
}

export class UsageError extends Error {}

export const HELP_TEXT = `testripple — which tests can this diff affect?

Usage:
  testripple [options]

Change selection (default: working tree + untracked vs HEAD):
  --base <ref>          diff against merge-base of <ref> and HEAD
  --staged              staged changes only (git diff --cached)
  --files <paths>       skip git; comma-separated changed files (repeatable)

Analysis:
  --root <dir>          project root to scan (default: the git repo root,
                        or the current directory with --files)
  --tsconfig <path>     tsconfig.json for baseUrl/paths (default: auto)
  --tests <glob>        test-file pattern, replaces defaults (repeatable)
  --run-all-on <glob>   run everything when a match changes (repeatable,
                        replaces defaults like package.json / tsconfig)
  --ignore <dir>        extra directory name to skip (repeatable)
  --no-type-only        ignore 'import type' edges

Output (test paths → stdout, summary → stderr):
  --format <f>          list (default) | json | null (NUL-separated)
  --why <test>          explain the import chain that selects one test
  -q, --quiet           suppress the stderr summary
  --fail-on-unresolved  exit 1 if any import failed to resolve

Misc:
  -h, --help            show this help
  -V, --version         print version

Exit codes: 0 ok · 1 --fail-on-unresolved hit or --why miss
            2 usage error · 3 runtime error
`;

export function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    staged: false,
    files: [],
    testPatterns: [],
    runAllPatterns: [],
    ignoreDirs: [],
    format: "list",
    skipTypeOnly: false,
    quiet: false,
    failOnUnresolved: false,
    help: false,
    version: false,
  };

  let i = 0;
  const next = (flag: string): string => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith("--")) {
      throw new UsageError(`${flag} requires a value`);
    }
    i++;
    return v;
  };

  for (; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case "--root":
        opts.root = next(arg);
        break;
      case "--base":
        opts.base = next(arg);
        break;
      case "--staged":
        opts.staged = true;
        break;
      case "--files":
        opts.files.push(
          ...next(arg)
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s !== ""),
        );
        break;
      case "--tests":
        opts.testPatterns.push(next(arg));
        break;
      case "--run-all-on":
        opts.runAllPatterns.push(next(arg));
        break;
      case "--ignore":
        opts.ignoreDirs.push(next(arg));
        break;
      case "--tsconfig":
        opts.tsconfigPath = next(arg);
        break;
      case "--format": {
        const value = next(arg);
        if (value !== "list" && value !== "json" && value !== "null") {
          throw new UsageError(
            `--format must be list, json or null (got "${value}")`,
          );
        }
        opts.format = value;
        break;
      }
      case "--why":
        opts.why = next(arg);
        break;
      case "--no-type-only":
        opts.skipTypeOnly = true;
        break;
      case "--quiet":
      case "-q":
        opts.quiet = true;
        break;
      case "--fail-on-unresolved":
        opts.failOnUnresolved = true;
        break;
      case "--help":
      case "-h":
        opts.help = true;
        break;
      case "--version":
      case "-V":
        opts.version = true;
        break;
      default:
        throw new UsageError(
          arg.startsWith("-")
            ? `unknown flag: ${arg}`
            : `unexpected argument: ${arg} (use --files to name changed files)`,
        );
    }
  }

  if (opts.staged && opts.base !== undefined) {
    throw new UsageError("--staged and --base are mutually exclusive");
  }
  if (opts.files.length > 0 && (opts.staged || opts.base !== undefined)) {
    throw new UsageError("--files replaces git discovery; drop --staged/--base");
  }
  return opts;
}
