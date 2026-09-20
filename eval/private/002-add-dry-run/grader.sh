#!/usr/bin/env bash
set -euo pipefail
ROOT="${1:-${EVAL_WORKSPACE:-.}}"
grep -q "dry-run" "$ROOT/cli.ts"
cp tests/cli.test.ts "$ROOT/cli.test.ts"
cd "$ROOT"
bun test cli.test.ts
