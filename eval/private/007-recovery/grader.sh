#!/usr/bin/env bash
set -euo pipefail
ROOT="${1:-${EVAL_WORKSPACE:-.}}"
grep -qx "complete" "$ROOT/DONE.txt"
