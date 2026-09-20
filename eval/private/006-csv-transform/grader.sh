#!/usr/bin/env bash
set -euo pipefail
ROOT="${1:-${EVAL_WORKSPACE:-.}}"
cd "$ROOT"
bun transform.ts
diff -u "$(dirname "$0")/tests/golden.csv" output.csv
