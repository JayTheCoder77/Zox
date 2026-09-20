#!/usr/bin/env bash
set -euo pipefail
ROOT="${1:-${EVAL_WORKSPACE:-.}}"
cp tests/wire.test.ts "$ROOT/wire.test.ts"
cd "$ROOT"
bun test wire.test.ts
