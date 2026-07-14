/**
 * Test-file classification. The defaults cover what the JS/TS ecosystem
 * actually does — `*.test.*` / `*.spec.*` naming, `__tests__` folders,
 * and top-level `test`/`tests` trees — and every default can be replaced
 * with `--tests <glob>` when a repo has its own convention.
 */

import { relative } from "node:path";
import { GlobSet } from "./glob.js";

export const DEFAULT_TEST_PATTERNS = [
  "**/*.test.{ts,tsx,mts,cts,js,jsx,mjs,cjs}",
  "**/*.spec.{ts,tsx,mts,cts,js,jsx,mjs,cjs}",
  "**/__tests__/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}",
  "test/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}",
  "tests/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}",
] as const;

/**
 * Files whose change means the whole suite should run: dependency and
 * compiler configuration reaches every module without a single `import`.
 */
export const DEFAULT_RUN_ALL_PATTERNS = [
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lockb",
  "tsconfig.json",
  "tsconfig.*.json",
  "*.config.{js,cjs,mjs,ts,mts,cts}",
  ".env",
  ".env.*",
] as const;

export interface TestMatcher {
  isTest(absPath: string): boolean;
  isRunAllTrigger(absPath: string): boolean;
}

export function createTestMatcher(
  root: string,
  testPatterns: readonly string[] = DEFAULT_TEST_PATTERNS,
  runAllPatterns: readonly string[] = DEFAULT_RUN_ALL_PATTERNS,
): TestMatcher {
  const tests = new GlobSet([...testPatterns]);
  const runAll = new GlobSet([...runAllPatterns]);
  return {
    isTest(absPath: string): boolean {
      return tests.matches(toRel(root, absPath));
    },
    isRunAllTrigger(absPath: string): boolean {
      return runAll.matches(toRel(root, absPath));
    },
  };
}

/** Root-relative, `/`-separated path for glob matching. */
export function toRel(root: string, absPath: string): string {
  return relative(root, absPath).split("\\").join("/");
}
