#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

export UV_CACHE_DIR="${UV_CACHE_DIR:-${TMPDIR:-/tmp}/map-data-provider-uv-cache}"

OFFLINE_FLAG=""
if [[ "${MDQ_OFFLINE:-0}" == "1" ]]; then
  OFFLINE_FLAG="--offline"
fi

printf '%s\n' "==> Running fast pre-push verification gate..."

printf '%s\n' "--> Python smoke check & linting (Ruff)..."
(cd backend && uv run $OFFLINE_FLAG ruff check . && uv run $OFFLINE_FLAG ruff format --check . && uv run $OFFLINE_FLAG python tests/smoke_check.py)

printf '%s\n' "--> Code formatting check (Prettier)..."
pnpm run format:check

printf '%s\n' "--> Node backend verification..."
pnpm run verify:node

printf '%s\n' "--> Frontend verification..."
pnpm run verify:frontend

printf '%s\n' "==> Fast pre-push verification passed. (Full integration tests & failure probes will run in parallel on CI)."
