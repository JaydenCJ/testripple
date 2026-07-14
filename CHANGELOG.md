# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-07-13

### Added

- Import scanner extracting specifiers from `import … from`, bare
  `import "x"`, `export … from`, dynamic `import("x")` and `require("x")`
  (literal arguments only), with lexer-grade skipping of comments,
  strings, template literals (descending into `${…}`) and regex
  literals, plus `import type` flagging and 1-based line tracking.
- tsc-style module resolution: extension probing, NodeNext
  output-extension remaps (`./x.js`→`./x.ts`, `./x.jsx`→`./x.tsx`),
  directory `index.*`, asset imports, tsconfig `baseUrl` and `paths`
  (exact over star, longest prefix wins) with tolerant JSONC parsing and
  relative `extends` chains.
- Reverse-reachability selection over the import graph, including a
  failed-candidate index so deleted modules still select the tests of
  their broken importers, and `--no-type-only` pruning.
- Changed-file discovery via NUL-delimited git plumbing: working tree +
  untracked (default), `--staged`, `--base <ref>` merge-base diffs, and
  a git-free `--files` mode.
- Test classification with replaceable glob patterns (`*.test.*`,
  `*.spec.*`, `__tests__/`, `test/`, `tests/` defaults) and run-all
  triggers for manifests, lockfiles and config files (`--run-all-on`).
- `--why <test>` explanations reconstructing the shortest chain of real
  import statements, with file:line per hop.
- Output contract: impacted test paths on stdout as `list`, `null`
  (NUL-separated) or stable `json` (`schema_version: 1`); human summary
  and diagnostics on stderr; `--quiet`; `--fail-on-unresolved` gate;
  exit codes 0/1/2/3.
- Programmatic API (`computeRipple`, `buildGraph`, `createMemoryHost`, …)
  with all filesystem access behind an injectable `FsHost`.
- Runnable examples (`examples/make-demo-repo.sh`,
  `examples/run-impacted.sh`) and a selection-semantics reference
  (`docs/selection-rules.md`).
- 91 deterministic offline tests (unit + CLI integration against
  fabricated git repositories) and `scripts/smoke.sh`.

[0.1.0]: https://github.com/JaydenCJ/testripple/releases/tag/v0.1.0
