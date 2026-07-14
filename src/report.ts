/**
 * Output rendering. The contract that makes testripple composable:
 * impacted test paths go to stdout (newline- or NUL-separated, ready for
 * xargs / a runner's argv), everything meant for humans goes to stderr.
 * JSON output is stable: fixed key order, sorted arrays, schema_version.
 */

import { toRel } from "./testmatch.js";
import type { RippleResult, WhyStep } from "./types.js";

export type OutputFormat = "list" | "json" | "null";

export interface RenderedReport {
  /** Machine-consumable payload for stdout. */
  stdout: string;
  /** Human summary for stderr ("" when --quiet). */
  stderr: string;
}

export function renderReport(
  result: RippleResult,
  root: string,
  format: OutputFormat,
  quiet: boolean,
): RenderedReport {
  const rel = (p: string): string => toRel(root, p);
  const tests = result.impactedTests.map(rel);

  let stdout: string;
  if (format === "json") {
    stdout = renderJson(result, rel) + "\n";
  } else if (format === "null") {
    stdout = tests.map((t) => t + "\0").join("");
  } else {
    stdout = tests.map((t) => t + "\n").join("");
  }

  return { stdout, stderr: quiet ? "" : renderSummary(result, rel) };
}

function renderJson(result: RippleResult, rel: (p: string) => string): string {
  return JSON.stringify(
    {
      schema_version: 1,
      run_all: result.runAll,
      run_all_reason: result.runAllReason ?? null,
      changed: result.changed.map(rel),
      impacted_tests: result.impactedTests.map(rel),
      affected_files: result.affectedFiles.map(rel),
      stats: {
        files_scanned: result.stats.filesScanned,
        import_edges: result.stats.edges,
        tests_discovered: result.stats.testsDiscovered,
        tests_impacted: result.impactedTests.length,
      },
      diagnostics: result.diagnostics.map((d) => ({
        severity: d.severity,
        message: d.message,
        file: d.file ? rel(d.file) : null,
        line: d.line ?? null,
      })),
    },
    null,
    2,
  );
}

/** "1 file" / "3 files" — summary lines must read right at any count. */
function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function renderSummary(result: RippleResult, rel: (p: string) => string): string {
  const lines: string[] = [];
  const { stats } = result;
  lines.push(
    `testripple: ${count(stats.filesScanned, "file")}, ` +
      `${count(stats.edges, "import edge")}, ${result.changed.length} changed`,
  );
  const ratio =
    `${result.impactedTests.length}/${stats.testsDiscovered} ` +
    `test file${stats.testsDiscovered === 1 ? "" : "s"}`;
  if (result.runAll) {
    lines.push(`run-all trigger: ${result.runAllReason ?? "configuration change"}`);
    lines.push(`selected ${ratio} (all)`);
  } else {
    lines.push(`selected ${ratio}`);
  }
  for (const d of result.diagnostics) {
    const where =
      d.file !== undefined
        ? ` (${rel(d.file)}${d.line !== undefined ? ":" + d.line : ""})`
        : "";
    lines.push(`${d.severity}: ${d.message}${where}`);
  }
  return lines.map((l) => l + "\n").join("");
}

/**
 * Renders the `--why <test>` explanation: the shortest chain of import
 * statements from a changed file to the given test, one hop per line.
 */
export function renderWhy(
  result: RippleResult,
  root: string,
  testPath: string,
): { text: string; found: boolean } {
  const rel = (p: string): string => toRel(root, p);
  const match = result.impactedTests.find(
    (t) => rel(t) === testPath || t === testPath,
  );
  if (match === undefined) {
    return {
      text: `${testPath} is not impacted by this change\n`,
      found: false,
    };
  }
  const chain = result.chains.get(match) ?? [];
  const lines: string[] = [];
  if (result.runAll) {
    lines.push(`${rel(match)} runs because a run-all trigger fired`);
  } else if (chain.length === 0) {
    lines.push(`${rel(match)} is itself a changed file`);
  } else {
    lines.push(`${rel(match)} is impacted:`);
    const first = chain[0]!;
    lines.push(`  changed: ${rel(first.imported)}`);
    for (const step of chain) {
      lines.push(
        `  ↳ imported by ${rel(step.importer)}:${step.line} ` +
          `(as "${step.specifier}")`,
      );
    }
  }
  return { text: lines.map((l) => l + "\n").join(""), found: true };
}

export { type WhyStep };
