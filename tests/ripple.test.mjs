// End-to-end pipeline tests over in-memory project trees: test selection,
// run-all triggers, tsconfig aliases, ignore rules, and reporting.
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRipple } from "../dist/ripple.js";
import { createMemoryHost } from "../dist/host.js";
import { renderReport, renderWhy } from "../dist/report.js";

/** A small but realistic project fixture used across several tests. */
function fixture(extra = {}) {
  return createMemoryHost({
    "/proj/src/math/add.ts": `export const add = (a, b) => a + b;`,
    "/proj/src/math/mul.ts": `import { add } from "./add.js";\nexport const mul = (a, b) => a * b + add(0, 0);`,
    "/proj/src/format.ts": `export const fmt = (n) => String(n);`,
    "/proj/src/app.ts": `import { mul } from "./math/mul.js";\nimport { fmt } from "./format.js";`,
    "/proj/tests/math.test.ts": `import { mul } from "../src/math/mul.js";`,
    "/proj/tests/format.test.ts": `import { fmt } from "../src/format.js";`,
    "/proj/tests/app.test.ts": `import "../src/app.js";`,
    ...extra,
  });
}

const rel = (result) => ({
  tests: result.impactedTests.map((p) => p.replace("/proj/", "")),
  all: result.allTests.map((p) => p.replace("/proj/", "")),
});

test("a leaf change selects only the tests that reach it", () => {
  const result = computeRipple(
    { root: "/proj", changed: ["/proj/src/format.ts"] },
    fixture(),
  );
  assert.deepEqual(rel(result).tests, ["tests/app.test.ts", "tests/format.test.ts"]);
  assert.equal(result.runAll, false);
  // Root-relative changed paths (as git reports them) behave identically.
  const relative = computeRipple(
    { root: "/proj", changed: ["src/format.ts"] },
    fixture(),
  );
  assert.deepEqual(rel(relative).tests, rel(result).tests);
});

test("a deep-dependency change fans out transitively", () => {
  const result = computeRipple(
    { root: "/proj", changed: ["/proj/src/math/add.ts"] },
    fixture(),
  );
  assert.deepEqual(rel(result).tests, ["tests/app.test.ts", "tests/math.test.ts"]);
});

test("changing a test file selects that test itself", () => {
  const result = computeRipple(
    { root: "/proj", changed: ["/proj/tests/format.test.ts"] },
    fixture(),
  );
  assert.deepEqual(rel(result).tests, ["tests/format.test.ts"]);
});

test("no changes selects no tests", () => {
  const result = computeRipple({ root: "/proj", changed: [] }, fixture());
  assert.deepEqual(result.impactedTests, []);
  assert.equal(result.stats.testsDiscovered, 3);
});

test("run-all triggers: package.json by default, custom patterns replace", () => {
  const result = computeRipple(
    { root: "/proj", changed: ["/proj/package.json"] },
    fixture({ "/proj/package.json": "{}" }),
  );
  assert.equal(result.runAll, true);
  assert.match(result.runAllReason, /package\.json changed/);
  assert.deepEqual(result.impactedTests, result.allTests);

  const custom = computeRipple(
    {
      root: "/proj",
      changed: ["/proj/schema.sql"],
      runAllPatterns: ["*.sql"],
    },
    fixture({ "/proj/schema.sql": "" }),
  );
  assert.equal(custom.runAll, true);
});

test("custom test patterns replace the defaults", () => {
  const host = createMemoryHost({
    "/proj/src/a.ts": ``,
    "/proj/checks/a.check.ts": `import "../src/a.js";`,
    "/proj/tests/ignored.test.ts": `import "../src/a.js";`,
  });
  const result = computeRipple(
    {
      root: "/proj",
      changed: ["/proj/src/a.ts"],
      testPatterns: ["checks/**/*.check.ts"],
    },
    host,
  );
  assert.deepEqual(result.impactedTests, ["/proj/checks/a.check.ts"]);
  assert.equal(result.stats.testsDiscovered, 1);
});

test("tsconfig path aliases connect the graph", () => {
  const host = createMemoryHost({
    "/proj/tsconfig.json": `{
      "compilerOptions": { "baseUrl": ".", "paths": { "@lib/*": ["src/lib/*"] } }
    }`,
    "/proj/src/lib/core.ts": ``,
    "/proj/tests/core.test.ts": `import { core } from "@lib/core";`,
  });
  const result = computeRipple(
    { root: "/proj", changed: ["/proj/src/lib/core.ts"] },
    host,
  );
  assert.deepEqual(result.impactedTests, ["/proj/tests/core.test.ts"]);
});

test("deleted source file selects the tests of its importers", () => {
  const host = createMemoryHost({
    "/proj/src/user.ts": `import { g } from "./gone.js";`,
    "/proj/tests/user.test.ts": `import "../src/user.js";`,
    "/proj/tests/other.test.ts": ``,
  });
  const result = computeRipple(
    { root: "/proj", changed: ["/proj/src/gone.ts"] },
    host,
  );
  assert.deepEqual(result.impactedTests, ["/proj/tests/user.test.ts"]);
});

test("changed file outside the graph produces an info diagnostic", () => {
  const result = computeRipple(
    { root: "/proj", changed: ["/proj/docs/notes.txt"] },
    fixture(),
  );
  assert.deepEqual(result.impactedTests, []);
  assert.ok(
    result.diagnostics.some((d) =>
      d.message.includes("not part of the import graph"),
    ),
  );
});

test("node_modules/dist are never scanned; extra ignore dirs are honored", () => {
  const host = fixture({
    "/proj/node_modules/pkg/index.js": `import "../../src/format.js";`,
    "/proj/dist/app.test.js": ``,
    "/proj/generated/big.test.ts": `import "../src/format.js";`,
  });
  const result = computeRipple(
    {
      root: "/proj",
      changed: ["/proj/src/format.ts"],
      ignoreDirs: ["generated"],
    },
    host,
  );
  assert.equal(
    result.affectedFiles.some((f) => f.includes("node_modules")),
    false,
  );
  assert.equal(
    result.impactedTests.some((t) => t.includes("generated")),
    false,
  );
  assert.equal(result.stats.testsDiscovered, 3);
});

test("skipTypeOnly prunes type-only fan-out end to end", () => {
  const host = createMemoryHost({
    "/proj/src/types.ts": `export type T = number;`,
    "/proj/tests/types.test.ts": `import type { T } from "../src/types.js";`,
  });
  const withTypes = computeRipple(
    { root: "/proj", changed: ["/proj/src/types.ts"] },
    host,
  );
  const without = computeRipple(
    { root: "/proj", changed: ["/proj/src/types.ts"], skipTypeOnly: true },
    host,
  );
  assert.equal(withTypes.impactedTests.length, 1);
  assert.equal(without.impactedTests.length, 0);
});

test("renderReport separates machine stdout from human stderr", () => {
  const result = computeRipple(
    { root: "/proj", changed: ["/proj/src/format.ts"] },
    fixture(),
  );
  const list = renderReport(result, "/proj", "list", false);
  assert.equal(list.stdout, "tests/app.test.ts\ntests/format.test.ts\n");
  assert.match(list.stderr, /selected 2\/3 test files/);
  const nul = renderReport(result, "/proj", "null", true);
  assert.equal(nul.stdout, "tests/app.test.ts\0tests/format.test.ts\0");
  assert.equal(nul.stderr, "");
});

test("renderReport json format is stable and versioned", () => {
  const result = computeRipple(
    { root: "/proj", changed: ["/proj/src/math/add.ts"] },
    fixture(),
  );
  const parsed = JSON.parse(renderReport(result, "/proj", "json", true).stdout);
  assert.equal(parsed.schema_version, 1);
  assert.equal(parsed.run_all, false);
  assert.deepEqual(parsed.impacted_tests, [
    "tests/app.test.ts",
    "tests/math.test.ts",
  ]);
  assert.equal(parsed.stats.tests_discovered, 3);
});

test("renderWhy prints the chain, and is honest about non-impacted tests", () => {
  const result = computeRipple(
    { root: "/proj", changed: ["/proj/src/math/add.ts"] },
    fixture(),
  );
  const why = renderWhy(result, "/proj", "tests/math.test.ts");
  assert.equal(why.found, true);
  assert.match(why.text, /changed: src\/math\/add\.ts/);
  assert.match(why.text, /imported by src\/math\/mul\.ts:1/);
  assert.match(why.text, /imported by tests\/math\.test\.ts:1/);
  const missed = renderWhy(result, "/proj", "tests/format.test.ts");
  assert.equal(missed.found, false);
  assert.match(missed.text, /not impacted/);
});
