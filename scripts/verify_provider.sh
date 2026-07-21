#!/bin/zsh
set -euo pipefail

cd "$(dirname "$0")/.."

(cd backend && uv run --offline pytest -q -W error && uv run --offline python tests/smoke_check.py)
(cd backend-node && npm run build && npm test && npm run lint)
(cd frontend && npm run build && npm run lint)
