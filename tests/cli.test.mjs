// CLI integration: the built dist/cli.js run as a child process against
// real temp directories and real (local, offline) git repositories.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

function run(args, cwd) {
  const proc = spawnSync("node", [CLI, ...args], { cwd, encoding: "utf8" });
  return { code: proc.status, stdout: proc.stdout, stderr: proc.stderr };
}

/** Creates a throwaway project; returns its root and a cleanup handle. */
function makeProject(files) {
  const root = mkdtempSync(join(tmpdir(), "testripple-"));
  for (const [rel, contents] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, contents);
  }
  return root;
}

function gitInit(root) {
  const env = { cwd: root };
  execFileSync("git", ["init", "-q", "-b", "main"], env);
  execFileSync("git", ["config", "user.email", "dev@example.test"], env);
  execFileSync("git", ["config", "user.name", "Dev"], env);
  execFileSync("git", ["add", "-A"], env);
  execFileSync("git", ["commit", "-q", "-m", "init"], env);
}

const PROJECT = {
  "src/core.ts": `export const core = 1;\n`,
  "src/feature.ts": `import { core } from "./core.js";\nexport const feature = core + 1;\n`,
  "src/island.ts": `export const island = 1;\n`,
  "tests/feature.test.ts": `import { feature } from "../src/feature.js";\n`,
  "tests/island.test.ts": `import { island } from "../src/island.js";\n`,
};

test("--version prints name and manifest version", () => {
  const { code, stdout } = run(["--version"], tmpdir());
  assert.equal(code, 0);
  assert.equal(stdout, "testripple 0.1.0\n");
});

test("--help documents every flag group", () => {
  const { code, stdout } = run(["--help"], tmpdir());
  assert.equal(code, 0);
  for (const flag of ["--base", "--staged", "--files", "--tests", "--why", "--format"]) {
    assert.ok(stdout.includes(flag), `help missing ${flag}`);
  }
});

test("usage errors exit 2 with a pointer to --help", () => {
  const unknown = run(["--bogus"], tmpdir());
  assert.equal(unknown.code, 2);
  assert.match(unknown.stderr, /unknown flag: --bogus/);
  assert.match(unknown.stderr, /--help/);
  const conflict = run(["--staged", "--base", "main"], tmpdir());
  assert.equal(conflict.code, 2);
  assert.match(conflict.stderr, /mutually exclusive/);
});

test("outside a git repo without --files exits 3 with a hint", () => {
  const root = makeProject({ "a.ts": "" });
  try {
    const { code, stderr } = run([], root);
    assert.equal(code, 3);
    assert.match(stderr, /--files/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--files mode needs no git at all", () => {
  const root = makeProject(PROJECT);
  try {
    const { code, stdout } = run(
      ["--root", root, "--files", join(root, "src/core.ts"), "--quiet"],
      root,
    );
    assert.equal(code, 0);
    assert.equal(stdout, "tests/feature.test.ts\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("uncommitted and untracked changes are detected via git", () => {
  const root = makeProject(PROJECT);
  try {
    gitInit(root);
    writeFileSync(join(root, "src/core.ts"), "export const core = 2;\n");
    const modified = run(["--quiet"], root);
    assert.equal(modified.code, 0);
    assert.equal(modified.stdout, "tests/feature.test.ts\n");
    // A brand-new (untracked) test file selects itself as well.
    writeFileSync(
      join(root, "tests/new.test.ts"),
      `import { island } from "../src/island.js";\n`,
    );
    const untracked = run(["--quiet"], root);
    assert.equal(
      untracked.stdout,
      "tests/feature.test.ts\ntests/new.test.ts\n",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("clean tree selects nothing", () => {
  const root = makeProject(PROJECT);
  try {
    gitInit(root);
    const { code, stdout, stderr } = run([], root);
    assert.equal(code, 0);
    assert.equal(stdout, "");
    assert.match(stderr, /selected 0\/2 test files/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("summary pluralizes correctly at a count of one", () => {
  const root = makeProject({
    "src/solo.ts": "export const solo = 1;\n",
    "tests/solo.test.ts": `import { solo } from "../src/solo.js";\n`,
  });
  try {
    const { stderr } = run(["--files", "src/solo.ts"], root);
    assert.match(stderr, /2 files, 1 import edge, 1 changed/);
    assert.match(stderr, /selected 1\/1 test file\n/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--staged sees only the index", () => {
  const root = makeProject(PROJECT);
  try {
    gitInit(root);
    writeFileSync(join(root, "src/island.ts"), "export const island = 2;\n");
    execFileSync("git", ["add", "src/island.ts"], { cwd: root });
    // A further unstaged edit must NOT count in --staged mode.
    writeFileSync(join(root, "src/core.ts"), "export const core = 3;\n");
    const { stdout } = run(["--staged", "--quiet"], root);
    assert.equal(stdout, "tests/island.test.ts\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--base diffs against the merge base of a branch", () => {
  const root = makeProject(PROJECT);
  try {
    gitInit(root);
    execFileSync("git", ["checkout", "-q", "-b", "feature"], { cwd: root });
    writeFileSync(join(root, "src/feature.ts"),
      `import { core } from "./core.js";\nexport const feature = core + 2;\n`);
    execFileSync("git", ["add", "-A"], { cwd: root });
    execFileSync("git", ["commit", "-q", "-m", "tweak feature"], { cwd: root });
    const { code, stdout } = run(["--base", "main", "--quiet"], root);
    assert.equal(code, 0);
    assert.equal(stdout, "tests/feature.test.ts\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("deleting a file selects the tests of its importers", () => {
  const root = makeProject(PROJECT);
  try {
    gitInit(root);
    unlinkSync(join(root, "src/core.ts"));
    const { stdout, stderr } = run([], root);
    assert.equal(stdout, "tests/feature.test.ts\n");
    assert.match(stderr, /unresolved import/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("package.json change runs everything with a reason", () => {
  const root = makeProject({ ...PROJECT, "package.json": "{}\n" });
  try {
    gitInit(root);
    writeFileSync(join(root, "package.json"), `{"name":"x"}\n`);
    const { stdout, stderr } = run([], root);
    assert.equal(stdout, "tests/feature.test.ts\ntests/island.test.ts\n");
    assert.match(stderr, /run-all trigger: package\.json changed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--why explains a hit (exit 0) and a miss (exit 1)", () => {
  const root = makeProject(PROJECT);
  try {
    const hit = run(
      ["--files", "src/core.ts", "--why", "tests/feature.test.ts"],
      root,
    );
    assert.equal(hit.code, 0);
    assert.match(hit.stdout, /changed: src\/core\.ts/);
    assert.match(hit.stdout, /imported by src\/feature\.ts:1/);
    assert.match(hit.stdout, /imported by tests\/feature\.test\.ts:1/);
    const miss = run(
      ["--files", "src/core.ts", "--why", "tests/island.test.ts"],
      root,
    );
    assert.equal(miss.code, 1);
    assert.match(miss.stdout, /not impacted/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--format json and --format null emit machine-clean output", () => {
  const root = makeProject(PROJECT);
  try {
    const json = run(
      ["--files", "src/core.ts", "--format", "json", "--quiet"],
      root,
    );
    const parsed = JSON.parse(json.stdout);
    assert.equal(parsed.schema_version, 1);
    assert.deepEqual(parsed.impacted_tests, ["tests/feature.test.ts"]);
    const nul = run(
      ["--files", "src/core.ts,src/island.ts", "--format", "null", "--quiet"],
      root,
    );
    assert.deepEqual(nul.stdout.split("\0").filter(Boolean), [
      "tests/feature.test.ts",
      "tests/island.test.ts",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--fail-on-unresolved exits 1 when imports dangle", () => {
  const root = makeProject({
    "src/broken.ts": `import { x } from "./nowhere.js";\n`,
    "tests/broken.test.ts": `import "../src/broken.js";\n`,
  });
  try {
    const ok = run(["--files", "src/broken.ts", "--quiet"], root);
    assert.equal(ok.code, 0); // without the flag, still exit 0
    const strict = run(
      ["--files", "src/broken.ts", "--quiet", "--fail-on-unresolved"],
      root,
    );
    assert.equal(strict.code, 1);
    assert.match(strict.stderr, /unresolved imports present/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("--tests replaces the default patterns end to end", () => {
  const root = makeProject({
    "src/a.ts": "export const a = 1;\n",
    "checks/a.check.ts": `import { a } from "../src/a.js";\n`,
    "tests/a.test.ts": `import { a } from "../src/a.js";\n`,
  });
  try {
    const { stdout } = run(
      ["--files", "src/a.ts", "--tests", "checks/**/*.check.ts", "--quiet"],
      root,
    );
    assert.equal(stdout, "checks/a.check.ts\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
