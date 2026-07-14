/**
 * The orchestrator: walk → tsconfig → graph → seed → reverse reach →
 * select tests. Pure with respect to its inputs — all filesystem access
 * goes through the injected FsHost, and nothing here touches git — so the
 * whole pipeline is exercised in-memory by the unit tests.
 */

import { isAbsolute, resolve } from "node:path";
import { buildGraph, chainFor, reverseReach } from "./graph.js";
import { createResolver } from "./resolve.js";
import {
  createTestMatcher,
  DEFAULT_RUN_ALL_PATTERNS,
  DEFAULT_TEST_PATTERNS,
  toRel,
} from "./testmatch.js";
import { loadTsconfig } from "./tsconfig.js";
import type { Diagnostic, FsHost, RippleOptions, RippleResult, WhyStep } from "./types.js";
import { walkProject } from "./walk.js";

export function computeRipple(opts: RippleOptions, host: FsHost): RippleResult {
  const root = resolve(opts.root);
  const diagnostics: Diagnostic[] = [];

  // 1. Discover the project and its test files.
  const files = walkProject(root, host, opts.ignoreDirs ?? []);
  const matcher = createTestMatcher(
    root,
    opts.testPatterns ?? DEFAULT_TEST_PATTERNS,
    opts.runAllPatterns ?? DEFAULT_RUN_ALL_PATTERNS,
  );
  const allTests = files.filter((f) => matcher.isTest(f));

  // 2. Load resolution config and build the import graph.
  const ts = loadTsconfig(root, host, opts.tsconfigPath);
  diagnostics.push(...ts.diagnostics);
  const resolver = createResolver(host, ts.config);
  const graph = buildGraph(files, host, resolver);
  diagnostics.push(...graph.diagnostics);

  // 3. Normalize the changed set and check run-all triggers.
  const changed = [...new Set(opts.changed.map((c) => normalizeChanged(root, c)))].sort();
  const trigger = changed.find((c) => matcher.isRunAllTrigger(c));
  if (trigger !== undefined) {
    return {
      impactedTests: allTests,
      affectedFiles: files,
      allTests,
      changed,
      runAll: true,
      runAllReason: `${toRel(root, trigger)} changed — configuration reaches every module`,
      diagnostics,
      chains: new Map(),
      stats: {
        filesScanned: files.length,
        edges: graph.edgeCount,
        testsDiscovered: allTests.length,
      },
    };
  }

  // 4. Warn about changed paths that are neither on disk nor known to any
  //    importer — a typo in --files, or a change to a file nothing uses.
  const fileSet = new Set(files);
  for (const c of changed) {
    if (!fileSet.has(c) && !graph.candidates.has(c) && !host.isFile(c)) {
      diagnostics.push({
        severity: "info",
        message: `changed file is not part of the import graph: ${toRel(root, c)}`,
        file: c,
      });
    }
  }

  // 5. Reverse reachability from the seeds.
  const reach = reverseReach(graph, changed, opts.skipTypeOnly ?? false);
  const affectedFiles = [...reach.affected].sort();
  const impactedTests = affectedFiles.filter((f) => matcher.isTest(f));

  // 6. Why-chains for every impacted test.
  const chains = new Map<string, WhyStep[]>();
  for (const test of impactedTests) {
    chains.set(test, chainFor(reach, test));
  }

  return {
    impactedTests,
    affectedFiles,
    allTests,
    changed,
    runAll: false,
    diagnostics,
    chains,
    stats: {
      filesScanned: files.length,
      edges: graph.edgeCount,
      testsDiscovered: allTests.length,
    },
  };
}

/** Changed paths may arrive root-relative (from git) or absolute. */
function normalizeChanged(root: string, p: string): string {
  return isAbsolute(p) ? resolve(p) : resolve(root, p);
}
