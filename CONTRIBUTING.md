# Contributing to testripple

Issues, discussions and pull requests are all welcome.

## Getting started

You need Node.js ≥22.13 and git ≥2.23; nothing else. The only
devDependency is `typescript`.

```bash
git clone https://github.com/JaydenCJ/testripple && cd testripple
npm install
npm test                 # tsc build + 91 node:test cases
bash scripts/smoke.sh
```

`scripts/smoke.sh` builds the CLI, fabricates a deterministic demo
repository in a temp dir, and asserts on real output across selection,
`--why`, JSON, deletion handling, run-all triggers and `--files` mode;
it must finish by printing `SMOKE OK`.

## Before you open a pull request

1. `npx tsc -p tsconfig.json --noEmit` reports no errors (strict mode is enforced).
2. `npm test` passes (91 deterministic tests, no network, no timing).
3. `bash scripts/smoke.sh` prints `SMOKE OK`.
4. Add tests for behavior changes; keep logic in pure, unit-testable
   modules (only `gitdiff.ts` shells out, only `host.ts` touches the
   real filesystem — everything else works against the `FsHost` interface).

## Ground rules

- Keep runtime dependencies at zero; adding one needs strong
  justification in the PR.
- No network calls, ever — testripple's only external interface is the
  local `git` binary. No telemetry.
- Selection must stay *sound within the graph*: when in doubt, select
  more tests, never fewer, and document any new limit in
  `docs/selection-rules.md`.
- Determinism first: identical input must produce byte-identical output,
  including all orderings.
- Code comments and doc comments are written in English.

## Reporting bugs

Include the output of `testripple --version`, the exact command you ran,
the stderr summary, and — for wrong selections — the relevant `--why`
output plus the import statements of the files involved, since that is
exactly what the analyzer sees. `--format json` output is ideal for
attaching.

## Security

Please do not open public issues for security problems; use GitHub's
private vulnerability reporting on this repository instead.
