# Selection rules

How testripple decides which test files a diff can affect. The goal is
**soundness within the import graph**: never drop a test that a changed
module can reach through imports, and be explicit about the cases static
analysis cannot see.

## 1. What counts as changed

| Mode | Git commands used | Meaning |
|---|---|---|
| default | `diff --name-only HEAD` + `ls-files --others --exclude-standard` | everything you touched since the last commit, including untracked files |
| `--staged` | `diff --name-only --cached` | the index only |
| `--base <ref>` | `diff <ref>...HEAD` + working tree + untracked | your whole branch relative to the merge base, plus local edits |
| `--files a,b` | none | explicit list; works without git |

All git plumbing is NUL-delimited, so unusual filenames survive.

## 2. What counts as an edge

The scanner extracts specifiers from `import … from`, `export … from`,
bare `import "x"`, dynamic `import("x")` and `require("x")` — literal
arguments only. It skips comments, strings, template literals and regex
literals with a real lexer-grade state machine, and descends into
template `${…}` expressions. `import type` edges are kept by default
(a type change can break a test at compile time); `--no-type-only`
drops them. Only the statement-level keyword makes an edge type-only:
`import { type T, v }` carries a value binding and is never pruned.

## 3. How specifiers resolve

1. Relative specifiers probe the written path, then NodeNext remaps
   (`./x.js` → `./x.ts`, `./x.jsx` → `./x.tsx`), then each source
   extension, then `index.*` inside a directory of that name.
2. Bare specifiers try tsconfig `paths` patterns (exact beats `*`,
   longest prefix wins), then `baseUrl`, and are otherwise **external**
   (npm packages, node builtins) — external edges never select tests.
3. Failed resolutions are recorded with every candidate path tried.
   When a *deleted* file appears in a diff, importers whose failed
   candidates include that path are selected — a deletion must ripple
   even though the file no longer exists.

`tsconfig.json` is discovered at the root (or `--tsconfig`), parsed
tolerantly (comments, trailing commas), and relative `extends` chains
are followed. Package-based `extends` is skipped with a note.

## 4. Which files are tests

Default patterns (replace all of them with repeated `--tests` flags):

```text
**/*.test.{ts,tsx,mts,cts,js,jsx,mjs,cjs}
**/*.spec.{ts,tsx,mts,cts,js,jsx,mjs,cjs}
**/__tests__/**/*.{ts,tsx,mts,cts,js,jsx,mjs,cjs}
test/**/*.{…same…}
tests/**/*.{…same…}
```

## 5. Run-all triggers

Some files reach every module without a single import: dependency
manifests, lockfiles, compiler and tool configuration. When a changed
file matches a trigger pattern, testripple selects **all** discovered
tests and says why on stderr. Defaults: `package.json`, the four common
lockfiles, `tsconfig.json` / `tsconfig.*.json`, `*.config.*`, `.env`,
`.env.*`. Replace them with repeated `--run-all-on` flags.

## 6. Honest limits

Static import analysis cannot see:

- **Runtime indirection** — `import(someVariable)`, dependency
  injection by string name, test fixtures loaded by path convention.
- **Global side effects** — module A mutating a global that module B
  reads, without any import between them.
- **Out-of-graph inputs** — databases, environment variables, files
  read at runtime.

For those, keep a periodic full run (nightly, or on merge) as a safety
net, and add the relevant globs to `--run-all-on`. The `--why` flag
exists so a surprising selection is always explainable, and
`--fail-on-unresolved` turns dangling imports into a hard failure.
