// tsconfig loading: baseUrl/paths extraction, JSONC tolerance, relative
// extends chains, and the failure modes that must degrade gracefully.
import { test } from "node:test";
import assert from "node:assert/strict";
import { loadTsconfig } from "../dist/tsconfig.js";
import { createMemoryHost } from "../dist/host.js";

test("missing tsconfig is silent by default, a warning when explicit", () => {
  const host = createMemoryHost({ "/proj/src/a.ts": "" });
  const auto = loadTsconfig("/proj", host);
  assert.deepEqual(auto.config, { paths: {} });
  assert.deepEqual(auto.diagnostics, []);
  assert.equal(auto.configPath, undefined);
  const explicit = loadTsconfig("/proj", host, "custom.json");
  assert.equal(explicit.diagnostics.length, 1);
  assert.match(explicit.diagnostics[0].message, /tsconfig not found/);
});

test("baseUrl and paths are made absolute against the config dir", () => {
  const host = createMemoryHost({
    "/proj/tsconfig.json": `{
      "compilerOptions": {
        "baseUrl": "./src",
        "paths": { "@app/*": ["app/*"], "@one": ["one.ts"] }
      }
    }`,
  });
  const { config } = loadTsconfig("/proj", host);
  assert.equal(config.baseUrl, "/proj/src");
  // paths are relative to baseUrl when baseUrl is set
  assert.deepEqual(config.paths["@app/*"], ["/proj/src/app/*"]);
  assert.deepEqual(config.paths["@one"], ["/proj/src/one.ts"]);
});

test("paths without baseUrl anchor at the config directory", () => {
  const host = createMemoryHost({
    "/proj/tsconfig.json": `{"compilerOptions": {"paths": {"@x/*": ["src/x/*"]}}}`,
  });
  const { config } = loadTsconfig("/proj", host);
  assert.deepEqual(config.paths["@x/*"], ["/proj/src/x/*"]);
});

test("comments and trailing commas parse (real-world tsconfig)", () => {
  const host = createMemoryHost({
    "/proj/tsconfig.json": `{
      // project config
      "compilerOptions": {
        "baseUrl": ".", /* anchor */
        "paths": {
          "@lib/*": ["lib/*"],
        },
      },
    }`,
  });
  const { config, diagnostics } = loadTsconfig("/proj", host);
  assert.deepEqual(diagnostics, []);
  assert.deepEqual(config.paths["@lib/*"], ["/proj/lib/*"]);
});

test("relative extends merges with child winning, .json suffix optional", () => {
  const host = createMemoryHost({
    "/proj/tsconfig.base.json": `{
      "compilerOptions": { "baseUrl": ".", "paths": { "@old/*": ["old/*"] } }
    }`,
    "/proj/tsconfig.json": `{
      "extends": "./tsconfig.base.json",
      "compilerOptions": { "paths": { "@new/*": ["new/*"] } }
    }`,
  });
  const { config } = loadTsconfig("/proj", host);
  assert.equal(config.baseUrl, "/proj"); // inherited
  assert.deepEqual(Object.keys(config.paths), ["@new/*"]); // replaced wholesale

  const bare = createMemoryHost({
    "/proj/base.json": `{"compilerOptions": {"baseUrl": "./b"}}`,
    "/proj/tsconfig.json": `{"extends": "./base"}`,
  });
  assert.equal(loadTsconfig("/proj", bare).config.baseUrl, "/proj/b");
});

test("package extends and missing extends targets degrade gracefully", () => {
  const pkg = createMemoryHost({
    "/proj/tsconfig.json": `{"extends": "@tsconfig/node22/tsconfig.json"}`,
  });
  const info = loadTsconfig("/proj", pkg).diagnostics;
  assert.equal(info.length, 1);
  assert.equal(info[0].severity, "info");
  assert.match(info[0].message, /only relative extends/);

  const gone = createMemoryHost({
    "/proj/tsconfig.json": `{"extends": "./gone.json"}`,
  });
  const warns = loadTsconfig("/proj", gone).diagnostics;
  assert.ok(warns.some((d) => /extends target not found/.test(d.message)));
});

test("unparseable tsconfig warns and disables aliases", () => {
  const host = createMemoryHost({ "/proj/tsconfig.json": `{"a": ` });
  const { config, diagnostics } = loadTsconfig("/proj", host);
  assert.deepEqual(config.paths, {});
  assert.ok(diagnostics.some((d) => /failed to parse/.test(d.message)));
});

test("circular extends is detected", () => {
  const host = createMemoryHost({
    "/proj/a.json": `{"extends": "./b.json"}`,
    "/proj/b.json": `{"extends": "./a.json"}`,
    "/proj/tsconfig.json": `{"extends": "./a.json"}`,
  });
  const { diagnostics } = loadTsconfig("/proj", host);
  assert.ok(diagnostics.some((d) => /circular tsconfig extends/.test(d.message)));
});
