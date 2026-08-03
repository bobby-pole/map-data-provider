#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

export UV_CACHE_DIR="${UV_CACHE_DIR:-${TMPDIR:-/tmp}/map-data-quality-lab-uv-cache}"

(cd backend && uv run --offline pytest -q -W error && uv run --offline python tests/smoke_check.py)
./scripts/verify_contract_failure_probe.sh
pnpm run verify:node
pnpm run verify:frontend

printf '%s\n' "Provider verification passed."
