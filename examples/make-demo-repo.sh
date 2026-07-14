#!/usr/bin/env bash
# Fabricates a small deterministic project + git history to try testripple
# against. Usage: bash examples/make-demo-repo.sh /tmp/ripple-demo
set -euo pipefail

DEST="${1:?usage: make-demo-repo.sh <dir>}"
rm -rf "$DEST"
mkdir -p "$DEST/src/billing" "$DEST/src/ui" "$DEST/src/shared" "$DEST/tests"
cd "$DEST"

cat > src/shared/money.ts <<'EOF'
export type Cents = number;
export const add = (a: Cents, b: Cents): Cents => a + b;
EOF

cat > src/billing/tax.ts <<'EOF'
import { Cents } from "../shared/money.js";
export const vat = (net: Cents): Cents => Math.round(net * 1.1);
EOF

cat > src/billing/invoice.ts <<'EOF'
import { add, Cents } from "../shared/money.js";
import { vat } from "./tax.js";
export const total = (net: Cents): Cents => add(net, vat(net) - net);
EOF

cat > src/ui/banner.ts <<'EOF'
export const banner = (): string => "ripple demo";
EOF

cat > tests/invoice.test.ts <<'EOF'
import { total } from "../src/billing/invoice.js";
// assert total(1000) === 1100 with your favorite runner
EOF

cat > tests/money.test.ts <<'EOF'
import { add } from "../src/shared/money.js";
EOF

cat > tests/banner.test.ts <<'EOF'
import { banner } from "../src/ui/banner.js";
EOF

git init -q -b main
git config user.email dev@example.test
git config user.name "Demo Dev"
git add -A
git commit -q -m "initial demo project"

# Leave an uncommitted edit so `testripple` has something to report.
cat > src/billing/tax.ts <<'EOF'
import { Cents } from "../shared/money.js";
export const vat = (net: Cents): Cents => Math.round(net * 1.2);
EOF

echo "demo repo ready at $DEST — now run:"
echo "  cd $DEST && testripple"
