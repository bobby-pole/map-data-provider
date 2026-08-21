#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

export UV_CACHE_DIR="${UV_CACHE_DIR:-${TMPDIR:-/tmp}/map-data-quality-lab-uv-cache}"

OFFLINE_FLAG=""
if [[ "${MDQ_OFFLINE:-0}" == "1" ]]; then
  OFFLINE_FLAG="--offline"
fi

pnpm run format:check
(cd backend && uv run $OFFLINE_FLAG ruff check . && uv run $OFFLINE_FLAG ruff format --check . && uv run $OFFLINE_FLAG pytest -q -W error -n auto && uv run $OFFLINE_FLAG python tests/smoke_check.py)
./scripts/verify_contract_failure_probe.sh
pnpm run verify:node
pnpm run verify:frontend

printf '%s\n' "Provider verification passed."
