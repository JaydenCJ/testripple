// Glob matching semantics: the exact subset documented in the README
// (`*`, `?`, `**`, `{a,b}`, bare-basename convenience).
import { test } from "node:test";
import assert from "node:assert/strict";
import { globToRegExp, GlobSet } from "../dist/glob.js";

const match = (glob, path) => globToRegExp(glob).test(path);

test("* and ? stay within a single path segment", () => {
  assert.equal(match("src/*.ts", "src/a.ts"), true);
  assert.equal(match("src/*.ts", "src/deep/a.ts"), false);
  assert.equal(match("src/?.ts", "src/a.ts"), true);
  assert.equal(match("src/?.ts", "src/ab.ts"), false);
  assert.equal(match("src/?.ts", "src/.ts"), false);
});

test("** spans zero or many segments", () => {
  assert.equal(match("**/x.ts", "x.ts"), true);
  assert.equal(match("**/x.ts", "a/b/c/x.ts"), true);
});

test("brace alternation, including stars inside branches", () => {
  assert.equal(match("*.{ts,tsx}", "app.tsx"), true);
  assert.equal(match("*.{ts,tsx}", "app.js"), false);
  assert.equal(match("src/{util,lib*}/a.ts", "src/libx/a.ts"), true);
  assert.equal(match("src/{util,lib*}/a.ts", "src/other/a.ts"), false);
});

test("pattern without a slash matches basenames anywhere", () => {
  assert.equal(match("*.spec.ts", "deep/nested/thing.spec.ts"), true);
  assert.equal(match("package.json", "pkg/package.json"), true);
});

test("pattern with a slash is anchored at the root", () => {
  assert.equal(match("tests/**/*.ts", "tests/a/b.ts"), true);
  assert.equal(match("tests/**/*.ts", "src/tests/a/b.ts"), false);
});

test("regex metacharacters in patterns are literal", () => {
  assert.equal(match("a.b/c+d.ts", "a.b/c+d.ts"), true);
  assert.equal(match("a.b/c+d.ts", "aXb/cccd.ts"), false);
});

test("unbalanced brace throws a descriptive error", () => {
  assert.throws(() => globToRegExp("src/{a,b.ts"), /unbalanced '\{'/);
});

test("GlobSet matches when any pattern matches", () => {
  const set = new GlobSet(["**/*.test.ts", "checks/**"]);
  assert.equal(set.matches("src/a.test.ts"), true);
  assert.equal(set.matches("checks/deep/file.ts"), true);
  assert.equal(set.matches("src/a.ts"), false);
});

test("leading ./ in a pattern is tolerated", () => {
  assert.equal(match("./src/*.ts", "src/a.ts"), true);
});
