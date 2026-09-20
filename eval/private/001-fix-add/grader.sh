#!/usr/bin/env bash
set -euo pipefail
ROOT="${1:-${EVAL_WORKSPACE:-.}}"
cp -a tests/. "$ROOT/"
cd "$ROOT"
bun test add.test.ts
