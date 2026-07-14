#!/usr/bin/env bash
# The one-liner testripple exists for: run only the tests a diff can
# affect. Works with any runner that accepts file paths as arguments.
# Usage: bash examples/run-impacted.sh [base-ref]
set -euo pipefail

BASE="${1:-main}"

# NUL-separated output survives any filename; `xargs -0 -r` skips the
# runner entirely when nothing is impacted.
testripple --base "$BASE" --format null --quiet \
  | xargs -0 -r node --test

# Variants for other runners (same selection, different consumer):
#   testripple --base "$BASE" | xargs -r npx vitest run
#   testripple --base "$BASE" | xargs -r npx jest --runTestsByPath
