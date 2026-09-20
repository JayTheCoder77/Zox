#!/usr/bin/env bash
set -euo pipefail
ROOT="${1:-${EVAL_WORKSPACE:-.}}"
grep -q "a.ts" "$ROOT/listing.txt"
grep -q "b.ts" "$ROOT/listing.txt"
