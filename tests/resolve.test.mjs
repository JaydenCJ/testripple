// Module resolution against an in-memory tree: extension probing,
// NodeNext `.js`→`.ts` mapping, index files, tsconfig paths/baseUrl,
// externals, and the failed-candidate trail used for deleted files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createResolver } from "../dist/resolve.js";
import { createMemoryHost } from "../dist/host.js";

const host = createMemoryHost({
  "/proj/src/app.ts": "",
  "/proj/src/util.ts": "",
  "/proj/src/widget.tsx": "",
  "/proj/src/legacy.js": "",
  "/proj/src/lib/index.ts": "",
  "/proj/src/styles/theme.css": "",
  "/proj/src/aliased/core.ts": "",
  "/proj/src/base/tool.ts": "",
});

const resolver = createResolver(host, {
  baseUrl: "/proj/src",
  paths: {
    "@app/*": ["/proj/src/aliased/*"],
    "@exact": ["/proj/src/util.ts"],
    "@app/deep/*": ["/proj/src/aliased/deep-*"],
  },
});

const from = "/proj/src/app.ts";
const r = (spec) => resolver.resolve(from, spec);

test("extensionless relative specifier finds .ts", () => {
  assert.deepEqual(r("./util"), { kind: "file", path: "/proj/src/util.ts" });
});

test("output-extension specifiers remap to sources (NodeNext style)", () => {
  // `./util.js` written in TS source refers to `./util.ts` on disk…
  assert.deepEqual(r("./util.js"), { kind: "file", path: "/proj/src/util.ts" });
  // …but a real .js file wins over the remap when both could exist…
  assert.deepEqual(r("./legacy.js"), {
    kind: "file",
    path: "/proj/src/legacy.js",
  });
  // …and .jsx maps to .tsx the same way.
  assert.deepEqual(r("./widget.jsx"), {
    kind: "file",
    path: "/proj/src/widget.tsx",
  });
});

test("directory specifier resolves to index file", () => {
  assert.deepEqual(r("./lib"), { kind: "file", path: "/proj/src/lib/index.ts" });
});

test("asset extensions resolve, with query/hash suffixes stripped", () => {
  assert.deepEqual(r("./styles/theme.css"), {
    kind: "file",
    path: "/proj/src/styles/theme.css",
  });
  assert.deepEqual(r("./styles/theme.css?inline"), {
    kind: "file",
    path: "/proj/src/styles/theme.css",
  });
});

test("parent-relative specifier resolves", () => {
  const res = resolver.resolve("/proj/src/lib/index.ts", "../util.js");
  assert.deepEqual(res, { kind: "file", path: "/proj/src/util.ts" });
});

test("bare specifier without alias is external", () => {
  assert.deepEqual(r("node:fs"), { kind: "external", specifier: "node:fs" });
  assert.equal(r("some-package").kind, "external");
  assert.equal(r("some-package/subpath").kind, "external");
});

test("tsconfig star alias resolves", () => {
  assert.deepEqual(r("@app/core"), {
    kind: "file",
    path: "/proj/src/aliased/core.ts",
  });
});

test("tsconfig exact alias resolves", () => {
  assert.deepEqual(r("@exact"), { kind: "file", path: "/proj/src/util.ts" });
});

test("longest alias prefix wins over a shorter one", () => {
  // `@app/deep/*` must beat `@app/*` for `@app/deep/x` (tsc's rule); the
  // target does not exist, so a correct pick surfaces as unresolved with
  // the deep-substituted candidate rather than external.
  const res = r("@app/deep/x");
  assert.equal(res.kind, "unresolved");
  assert.ok(res.tried.some((p) => p.includes("aliased/deep-x")));
});

test("aliased specifier with no target file is unresolved, not external", () => {
  const res = r("@app/missing");
  assert.equal(res.kind, "unresolved");
  assert.ok(res.tried.length > 0);
});

test("baseUrl resolves bare specifiers that exist under it", () => {
  assert.deepEqual(r("base/tool"), {
    kind: "file",
    path: "/proj/src/base/tool.ts",
  });
});

test("missing relative file is unresolved with a candidate trail", () => {
  const res = r("./missing.js");
  assert.equal(res.kind, "unresolved");
  // The exact path a deleted `missing.ts` used to occupy must be present
  // so the graph can attribute impact for deletions.
  assert.ok(res.tried.includes("/proj/src/missing.ts"));
  assert.ok(res.tried.includes("/proj/src/missing.js"));
});
