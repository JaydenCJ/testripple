# testripple examples

Two runnable scripts, both offline and deterministic:

- **`make-demo-repo.sh <dir>`** — fabricates a small project (three test
  files, a shared module, a billing chain) with a git history and one
  uncommitted edit, so every CLI mode has something real to show:

  ```bash
  bash examples/make-demo-repo.sh /tmp/ripple-demo
  cd /tmp/ripple-demo && testripple
  testripple --why tests/invoice.test.ts
  ```

- **`run-impacted.sh [base-ref]`** — the CI-shaped one-liner: select the
  tests a branch can affect and hand them straight to `node --test`
  (variants for vitest and jest are in the comments). Run it inside any
  git repository with a `main` branch, e.g. the demo repo above after
  committing the edit to a feature branch.

Neither script touches the network; the demo repo is rebuilt from scratch
on every invocation, so both are safe to re-run.
