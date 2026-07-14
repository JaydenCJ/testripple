/**
 * Shared types for testripple. Everything here is plain data — the core
 * pipeline (scan → resolve → graph → select) is pure and unit-testable;
 * all filesystem and git access goes through the narrow host interfaces
 * below so tests can run against in-memory trees.
 */

/** How an import specifier appeared in source. */
export type ImportKind = "import" | "export-from" | "dynamic-import" | "require";

/** One module specifier extracted from a source file. */
export interface ImportRef {
  /** The raw specifier text, e.g. `./util.js` or `lodash`. */
  specifier: string;
  /** Syntactic form the specifier appeared in. */
  kind: ImportKind;
  /** 1-based line number of the specifier (for diagnostics and --why). */
  line: number;
  /** True for `import type` / `export type` — still an edge, but flagged. */
  typeOnly: boolean;
}

/** Result of resolving one specifier from one file. */
export type Resolution =
  | { kind: "file"; path: string }
  | { kind: "external"; specifier: string }
  | { kind: "unresolved"; specifier: string; tried: string[] };

/** Read-only filesystem view used by the resolver and the walker. */
export interface FsHost {
  /** True if `path` exists and is a regular file. */
  isFile(path: string): boolean;
  /** True if `path` exists and is a directory. */
  isDirectory(path: string): boolean;
  /** Returns UTF-8 file contents; throws if unreadable. */
  readFile(path: string): string;
  /** Lists directory entries with a file/dir flag; [] if unreadable. */
  readDir(path: string): Array<{ name: string; isDirectory: boolean }>;
}

/** A non-fatal problem discovered during analysis. */
export interface Diagnostic {
  severity: "warn" | "info";
  message: string;
  /** Absolute file path the diagnostic is about, when applicable. */
  file?: string;
  line?: number;
}

/** tsconfig-derived resolution settings (already made absolute). */
export interface PathsConfig {
  /** Absolute directory `paths` patterns are relative to. */
  baseUrl?: string;
  /** Pattern → substitution list, e.g. `@app/*` → [`src/app/*`]. */
  paths: Record<string, string[]>;
}

/** One reason a file was pulled into the impacted set. */
export interface WhyStep {
  /** Absolute path of the importing file. */
  importer: string;
  /** Absolute path of the imported file. */
  imported: string;
  /** Line in `importer` where the edge originates. */
  line: number;
  /** The specifier text as written. */
  specifier: string;
}

/** Options for the core `computeRipple` pipeline. */
export interface RippleOptions {
  /** Absolute project root; the walk and all output are anchored here. */
  root: string;
  /** Changed files, absolute or root-relative. May include deleted paths. */
  changed: string[];
  /** Glob patterns marking test files (relative to root). */
  testPatterns?: string[];
  /** Extra directory names to skip during the walk. */
  ignoreDirs?: string[];
  /** Globs whose change means "run everything" (configs, lockfiles…). */
  runAllPatterns?: string[];
  /** Explicit tsconfig path; default is `<root>/tsconfig.json` if present. */
  tsconfigPath?: string;
  /** Ignore `import type` edges when tracing impact. Default false. */
  skipTypeOnly?: boolean;
}

/** Aggregate result of an impact analysis. */
export interface RippleResult {
  /** Absolute paths of impacted test files, sorted. */
  impactedTests: string[];
  /** All files (tests and not) reachable from the change, sorted. */
  affectedFiles: string[];
  /** Absolute paths of every discovered test file, sorted. */
  allTests: string[];
  /** The changed files actually used as seeds (normalized, sorted). */
  changed: string[];
  /** True when a run-all trigger fired; impactedTests === allTests then. */
  runAll: boolean;
  /** Human-readable reason when `runAll` is true. */
  runAllReason?: string;
  /** Warnings and notes (unresolved imports, missing files…). */
  diagnostics: Diagnostic[];
  /** Import chains: test path → shortest chain back to a changed file. */
  chains: Map<string, WhyStep[]>;
  stats: {
    filesScanned: number;
    edges: number;
    testsDiscovered: number;
  };
}
