#!/usr/bin/env bash
set -euo pipefail
ROOT="${1:-${EVAL_WORKSPACE:-.}}"
cp tests/index.test.ts "$ROOT/index.test.ts"
cd "$ROOT"
bun test index.test.ts
