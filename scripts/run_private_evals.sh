#!/usr/bin/env bash
# run_private_evals.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HARNESS="${HARNESS:-bun $ROOT/packages/cli/src/index.ts}"
MODEL="${MODEL:?set MODEL to a real provider/id}"
K="${K:-3}"

exec $HARNESS eval private eval/private --model "$MODEL" --k "$K" --auto-approve
