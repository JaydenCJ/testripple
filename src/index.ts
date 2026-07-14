/**
 * testripple public API. The CLI is a thin wrapper over these exports;
 * embedders (editor extensions, custom CI scripts) can run the same
 * analysis programmatically against the real filesystem or a virtual one.
 */

export { computeRipple } from "./ripple.js";
export { createMemoryHost, createNodeHost } from "./host.js";
export { extractImports } from "./scan.js";
export { createResolver, matchPaths, SOURCE_EXTENSIONS } from "./resolve.js";
export { buildGraph, chainFor, reverseReach } from "./graph.js";
export type { Edge, ImportGraph, ReachResult } from "./graph.js";
export { globToRegExp, GlobSet } from "./glob.js";
export { parseJsonc, stripJsonc } from "./jsonc.js";
export { loadTsconfig } from "./tsconfig.js";
export {
  createTestMatcher,
  DEFAULT_RUN_ALL_PATTERNS,
  DEFAULT_TEST_PATTERNS,
  toRel,
} from "./testmatch.js";
export { walkProject, DEFAULT_IGNORE_DIRS, isSourceFile } from "./walk.js";
export { changedFilesFromGit, GitError } from "./gitdiff.js";
export { renderReport, renderWhy } from "./report.js";
export type { OutputFormat, RenderedReport } from "./report.js";
export { parseArgs, UsageError, HELP_TEXT } from "./cliargs.js";
export type { CliOptions } from "./cliargs.js";
export { VERSION } from "./version.js";
export type {
  Diagnostic,
  FsHost,
  ImportKind,
  ImportRef,
  PathsConfig,
  Resolution,
  RippleOptions,
  RippleResult,
  WhyStep,
} from "./types.js";
