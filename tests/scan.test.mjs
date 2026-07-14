// Import-specifier extraction: every syntactic form testripple claims to
// understand, plus the traps (comments, strings, templates, regexes) that
// make naive regex-based scanners report false edges.
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractImports } from "../dist/scan.js";

const specs = (src) => extractImports(src).map((r) => r.specifier);

test("static import clause variants all yield one edge", () => {
  assert.deepEqual(specs(`import { a, b } from "./mod.js";`), ["./mod.js"]);
  assert.deepEqual(
    specs(`import def from './a.js';\nimport * as ns from './b.js';`),
    ["./a.js", "./b.js"],
  );
  assert.deepEqual(specs(`import d, { x, y as z } from "./m.js";`), ["./m.js"]);
  assert.deepEqual(specs(`import "./polyfill.js";`), ["./polyfill.js"]);
});

test("export ... from re-export forms", () => {
  const src = `export { a } from "./a.js";\nexport * from './b.js';\nexport { default as c } from "./c.js";`;
  assert.deepEqual(specs(src), ["./a.js", "./b.js", "./c.js"]);
});

test("plain export declarations produce no edge", () => {
  const src = `export const x = 1;\nexport function f() {}\nexport default class C {}\nexport { x };`;
  assert.deepEqual(specs(src), []);
});

test("import type / export type ... from are flagged typeOnly", () => {
  const imp = extractImports(`import type { T } from "./types.js";`);
  assert.equal(imp.length, 1);
  assert.equal(imp[0].typeOnly, true);
  const exp = extractImports(`export type { T } from "./types.js";`);
  assert.equal(exp.length, 1);
  assert.equal(exp[0].typeOnly, true);
  assert.equal(exp[0].kind, "export-from");
});

test("inline type specifiers do not make the edge type-only", () => {
  // `import { type T, v }` carries a value binding; flagging it typeOnly
  // would let --no-type-only prune a real runtime edge — and drop tests.
  const mixed = extractImports(`import { type T, realValue } from "./m.js";`);
  assert.equal(mixed.length, 1);
  assert.equal(mixed[0].typeOnly, false);
  const exp = extractImports(`export { type T } from "./m.js";`);
  assert.equal(exp[0].typeOnly, false);
});

test("dynamic import: literal argument found, variable skipped", () => {
  const refs = extractImports(`const m = await import("./lazy.js");`);
  assert.deepEqual(refs.map((r) => [r.specifier, r.kind]), [
    ["./lazy.js", "dynamic-import"],
  ]);
  assert.deepEqual(specs(`const m = await import(pathVar);`), []);
});

test("require with a literal argument", () => {
  const refs = extractImports(`const fs = require("./shim.cjs");`);
  assert.deepEqual(refs.map((r) => [r.specifier, r.kind]), [
    ["./shim.cjs", "require"],
  ]);
});

test("member access and import.meta are not imports", () => {
  assert.deepEqual(specs(`foo.require("./x.js"); bar.import("./y.js");`), []);
  assert.deepEqual(specs(`const u = import.meta.url;`), []);
});

test("imports inside comments are ignored", () => {
  assert.deepEqual(specs(`// import "./ghost.js"\nconst x = 1;`), []);
  assert.deepEqual(specs(`/*\nimport "./ghost.js";\n*/ import "./real.js";`), [
    "./real.js",
  ]);
});

test("imports inside string and template literals are ignored", () => {
  const src = `const s = 'import "./ghost.js"'; const t = "require('./ghost2.js')";`;
  assert.deepEqual(specs(src), []);
  assert.deepEqual(specs("const s = `import './ghost.js'`;"), []);
});

test("dynamic import inside a template expression is found", () => {
  // Generated code does this; the scanner descends into ${...}.
  assert.deepEqual(specs("const s = `${await import('./inner.js')}`;"), [
    "./inner.js",
  ]);
});

test("regex literals and division do not derail the scanner", () => {
  // A naive scanner treats the quote in the regex as a string opener and
  // then misses (or invents) every edge after it.
  const withRegex = `const re = /['"]/g;\nimport { a } from "./after.js";`;
  assert.deepEqual(specs(withRegex), ["./after.js"]);
  const withDivision = `const x = total / count; // '\nimport "./after.js";`;
  assert.deepEqual(specs(withDivision), ["./after.js"]);
});

test("line numbers are 1-based, accurate, and follow multiline clauses", () => {
  const src = `const a = 1;\n\nimport { x } from "./x.js";\nconst b = 2;\nexport { y } from "./y.js";`;
  assert.deepEqual(extractImports(src).map((r) => [r.specifier, r.line]), [
    ["./x.js", 3],
    ["./y.js", 5],
  ]);
  const wide = `import {\n  alpha,\n  beta,\n} from "./wide.js";`;
  assert.equal(extractImports(wide)[0].line, 4);
});

test("escaped quotes in specifiers survive; empty source yields nothing", () => {
  assert.deepEqual(specs(`import "./we\\"ird.js";`), [`./we"ird.js`]);
  assert.deepEqual(specs(""), []);
});
