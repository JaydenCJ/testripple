#!/usr/bin/env bash
# End-to-end smoke test for testripple. No network, idempotent, runs from
# a clean tree. This script plus 'npm test' is the whole verification
# story — the repository intentionally ships no CI.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

fail() {
  echo "SMOKE FAIL: $*" >&2
  exit 1
}

CLI="$ROOT/dist/cli.js"
PROJ="$WORKDIR/demo"

echo "[1/9] build"
(cd "$ROOT" && npm run --silent build) || fail "tsc build failed"
[ -f "$CLI" ] || fail "dist/cli.js missing after build"

echo "[2/9] --version matches the manifest version"
VERSION_OUT="$(node "$CLI" --version)"
[ "$VERSION_OUT" = "testripple 0.1.0" ] || fail "unexpected version output: $VERSION_OUT"

echo "[3/9] fabricate a demo repository"
mkdir -p "$PROJ/src/billing" "$PROJ/src/ui" "$PROJ/tests"
cat > "$PROJ/src/billing/tax.ts" <<'EOF'
export const vat = (net: number): number => net * 1.1;
EOF
cat > "$PROJ/src/billing/invoice.ts" <<'EOF'
import { vat } from "./tax.js";
export const total = (net: number): number => vat(net);
EOF
cat > "$PROJ/src/ui/banner.ts" <<'EOF'
export const banner = (): string => "hello";
EOF
cat > "$PROJ/tests/invoice.test.ts" <<'EOF'
import { total } from "../src/billing/invoice.js";
EOF
cat > "$PROJ/tests/banner.test.ts" <<'EOF'
import { banner } from "../src/ui/banner.js";
EOF
(cd "$PROJ" \
  && git init -q -b main \
  && git config user.email dev@example.test \
  && git config user.name Dev \
  && git add -A \
  && git commit -q -m init) || fail "git setup failed"

echo "[4/9] clean tree selects zero tests"
CLEAN_OUT="$(cd "$PROJ" && node "$CLI" --quiet)"
[ -z "$CLEAN_OUT" ] || fail "clean tree selected: $CLEAN_OUT"

echo "[5/9] deep change selects exactly the reaching test"
printf 'export const vat = (net: number): number => net * 1.2;\n' > "$PROJ/src/billing/tax.ts"
IMPACT_OUT="$(cd "$PROJ" && node "$CLI" --quiet)"
[ "$IMPACT_OUT" = "tests/invoice.test.ts" ] || fail "unexpected selection: $IMPACT_OUT"

echo "[6/9] --why explains the chain with file:line hops"
WHY_OUT="$(cd "$PROJ" && node "$CLI" --why tests/invoice.test.ts)"
echo "$WHY_OUT" | grep -q "changed: src/billing/tax.ts" || fail "--why missing changed seed"
echo "$WHY_OUT" | grep -q "imported by src/billing/invoice.ts:1" || fail "--why missing hop"
echo "$WHY_OUT" | grep -q "imported by tests/invoice.test.ts:1" || fail "--why missing test hop"

echo "[7/9] --format json is stable machine output"
JSON_OUT="$(cd "$PROJ" && node "$CLI" --format json --quiet)"
echo "$JSON_OUT" | grep -q '"schema_version": 1' || fail "json missing schema_version"
echo "$JSON_OUT" | grep -q '"tests/invoice.test.ts"' || fail "json missing impacted test"
echo "$JSON_OUT" | node -e 'JSON.parse(require("node:fs").readFileSync(0,"utf8"))' \
  || fail "json output does not parse"

echo "[8/9] deleting a module still selects its importers' tests"
rm "$PROJ/src/billing/tax.ts"
DEL_OUT="$(cd "$PROJ" && node "$CLI" --quiet 2>/dev/null)"
[ "$DEL_OUT" = "tests/invoice.test.ts" ] || fail "deletion selection wrong: $DEL_OUT"
(cd "$PROJ" && git checkout -q -- src/billing/tax.ts)

echo "[9/9] run-all trigger and no-git --files mode"
printf '{"name":"demo"}\n' > "$PROJ/package.json"
ALL_OUT="$(cd "$PROJ" && node "$CLI" --quiet)"
[ "$ALL_OUT" = "$(printf 'tests/banner.test.ts\ntests/invoice.test.ts')" ] \
  || fail "run-all did not select everything: $ALL_OUT"
rm "$PROJ/package.json"
NOGIT="$WORKDIR/nogit"
mkdir -p "$NOGIT"
cp -r "$PROJ/src" "$PROJ/tests" "$NOGIT/"
FILES_OUT="$(cd "$NOGIT" && node "$CLI" --files src/ui/banner.ts --quiet)"
[ "$FILES_OUT" = "tests/banner.test.ts" ] || fail "--files mode wrong: $FILES_OUT"

echo "SMOKE OK"
