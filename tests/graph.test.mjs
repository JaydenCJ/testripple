// Graph construction and reverse reachability: transitive closure,
// cycles, diamonds, deleted-file attribution, type-only filtering, and
// why-chain reconstruction.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildGraph, chainFor, reverseReach } from "../dist/graph.js";
import { createResolver } from "../dist/resolve.js";
import { createMemoryHost } from "../dist/host.js";

function makeGraph(files) {
  const host = createMemoryHost(files);
  const resolver = createResolver(host, { paths: {} });
  const paths = Object.keys(files).sort();
  return buildGraph(paths, host, resolver);
}

test("impact is transitive through many hops", () => {
  const g = makeGraph({
    "/p/a.ts": ``,
    "/p/b.ts": `import "./a.js";`,
    "/p/c.ts": `import "./b.js";`,
    "/p/d.ts": `import "./c.js";`,
    "/p/unrelated.ts": `export const u = 1;`,
  });
  const reach = reverseReach(g, ["/p/a.ts"]);
  assert.equal(reach.affected.size, 4);
  assert.equal(reach.affected.has("/p/unrelated.ts"), false);
});

test("cycles terminate and every member is affected", () => {
  const g = makeGraph({
    "/p/a.ts": `import "./b.js";`,
    "/p/b.ts": `import "./a.js";`,
    "/p/c.ts": `import "./a.js";`,
  });
  const reach = reverseReach(g, ["/p/b.ts"]);
  assert.deepEqual([...reach.affected].sort(), ["/p/a.ts", "/p/b.ts", "/p/c.ts"]);
});

test("diamond dependencies are visited once", () => {
  const g = makeGraph({
    "/p/base.ts": ``,
    "/p/left.ts": `import "./base.js";`,
    "/p/right.ts": `import "./base.js";`,
    "/p/top.ts": `import "./left.js"; import "./right.js";`,
  });
  const reach = reverseReach(g, ["/p/base.ts"]);
  assert.equal(reach.affected.size, 4);
});

test("deleted file still ripples via failed-resolution candidates", () => {
  // `gone.ts` does not exist (it was deleted in the diff); its importer
  // must still be selected, because that importer is now broken.
  const g = makeGraph({
    "/p/user.ts": `import { g } from "./gone.js";`,
    "/p/bystander.ts": ``,
  });
  const reach = reverseReach(g, ["/p/gone.ts"]);
  assert.deepEqual([...reach.affected], ["/p/user.ts"]);
  // The dangling import is also surfaced as a warning with its line.
  assert.equal(g.diagnostics.length, 1);
  assert.match(g.diagnostics[0].message, /unresolved import "\.\/gone\.js"/);
  assert.equal(g.diagnostics[0].line, 1);
});

test("chain for a deleted seed names the deleted path, not the specifier", () => {
  // The why-chain for a deletion must start at the deleted file itself
  // (a root-anchored path), never at the importer-relative specifier text
  // ("./gone.js"), which would render as a bogus path in --why output.
  const g = makeGraph({
    "/p/user.ts": `import { g } from "./gone.js";`,
    "/p/top.test.ts": `import "./user.js";`,
  });
  const reach = reverseReach(g, ["/p/gone.ts"]);
  const chain = chainFor(reach, "/p/top.test.ts");
  assert.equal(chain.length, 2);
  assert.equal(chain[0].imported, "/p/gone.ts");
  assert.equal(chain[0].specifier, "./gone.js");
  assert.equal(chain[1].importer, "/p/top.test.ts");
});

test("external imports create no edges and no diagnostics", () => {
  const g = makeGraph({
    "/p/a.ts": `import { readFileSync } from "node:fs";\nimport x from "left-pad";`,
  });
  assert.equal(g.edgeCount, 0);
  assert.deepEqual(g.diagnostics, []);
});

test("type-only edges propagate by default", () => {
  const g = makeGraph({
    "/p/types.ts": `export type T = number;`,
    "/p/use.ts": `import type { T } from "./types.js";`,
  });
  const reach = reverseReach(g, ["/p/types.ts"]);
  assert.equal(reach.affected.has("/p/use.ts"), true);
});

test("type-only edges are skipped when requested", () => {
  const g = makeGraph({
    "/p/types.ts": `export type T = number;`,
    "/p/use.ts": `import type { T } from "./types.js";`,
    "/p/real.ts": `import { anything } from "./types.js";`,
  });
  const reach = reverseReach(g, ["/p/types.ts"], true);
  assert.equal(reach.affected.has("/p/use.ts"), false);
  assert.equal(reach.affected.has("/p/real.ts"), true);
});

test("chainFor reconstructs the shortest hop sequence", () => {
  const g = makeGraph({
    "/p/core.ts": ``,
    "/p/mid.ts": `import "./core.js";`,
    "/p/outer.ts": `\nimport "./mid.js";`,
  });
  const reach = reverseReach(g, ["/p/core.ts"]);
  const chain = chainFor(reach, "/p/outer.ts");
  assert.deepEqual(
    chain.map((s) => [s.importer, s.imported, s.line]),
    [
      ["/p/mid.ts", "/p/core.ts", 1],
      ["/p/outer.ts", "/p/mid.ts", 2],
    ],
  );
  // A seed has no chain: it was changed directly.
  assert.deepEqual(chainFor(reach, "/p/core.ts"), []);
});

test("edge metadata records specifier text and line", () => {
  const g = makeGraph({
    "/p/a.ts": ``,
    "/p/b.ts": `// lead-in\nimport { a } from "./a.js";`,
  });
  const edges = g.reverse.get("/p/a.ts");
  assert.equal(edges.length, 1);
  assert.equal(edges[0].specifier, "./a.js");
  assert.equal(edges[0].line, 2);
});
