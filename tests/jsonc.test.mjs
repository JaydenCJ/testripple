// JSONC handling for tsconfig files: comments, trailing commas, and the
// cases where comment-looking bytes live inside strings and must survive.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseJsonc, stripJsonc } from "../dist/jsonc.js";

test("plain JSON passes through", () => {
  assert.deepEqual(parseJsonc(`{"a": 1, "b": [true, null]}`), {
    a: 1,
    b: [true, null],
  });
});

test("line and block comments are stripped", () => {
  assert.deepEqual(parseJsonc(`{\n// comment\n"a": 1 // tail\n}`), { a: 1 });
  assert.deepEqual(parseJsonc(`{/* x */ "a": /* y */ 1}`), { a: 1 });
});

test("multiline block comments preserve line structure", () => {
  const stripped = stripJsonc(`{\n/* a\nb\nc */\n"k": 1\n}`);
  assert.equal(stripped.split("\n").length, 6);
});

test("trailing commas in objects and arrays are removed", () => {
  assert.deepEqual(parseJsonc(`{"a": 1,}`), { a: 1 });
  assert.deepEqual(parseJsonc(`{"a": [1, 2,]}`), { a: [1, 2] });
});

test("trailing comma followed by a comment is removed", () => {
  assert.deepEqual(parseJsonc(`{"a": 1, // last\n}`), { a: 1 });
  assert.deepEqual(parseJsonc(`{"a": 1, /* last */ }`), { a: 1 });
});

test("comma between elements is kept", () => {
  assert.deepEqual(parseJsonc(`[1, 2, 3]`), [1, 2, 3]);
});

test("comment markers and escaped quotes inside strings are preserved", () => {
  assert.deepEqual(parseJsonc(`{"url": "http://example.test/x", "c": "a//b"}`), {
    url: "http://example.test/x",
    c: "a//b",
  });
  assert.deepEqual(parseJsonc(`{"s": "say \\"hi\\" // not a comment"}`), {
    s: `say "hi" // not a comment`,
  });
});

test("real syntax errors still throw", () => {
  assert.throws(() => parseJsonc(`{"a": }`));
});
