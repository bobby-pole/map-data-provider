#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

(cd backend && uv run --offline pytest -q -W error && uv run --offline python tests/smoke_check.py)
./scripts/verify_contract_failure_probe.sh
(cd backend-node && npm run build && npm test && npm run lint)
(cd frontend && npm test && npm run build && npm run lint)

printf '%s\n' "Provider verification passed."
