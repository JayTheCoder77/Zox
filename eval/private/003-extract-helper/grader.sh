#!/usr/bin/env bash
set -euo pipefail
ROOT="${1:-${EVAL_WORKSPACE:-.}}"
grep -q "function inc(" "$ROOT/math.ts"
cp tests/math.test.ts "$ROOT/math.test.ts"
cd "$ROOT"
bun test math.test.ts
