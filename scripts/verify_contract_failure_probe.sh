#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

set +e
(cd backend && MDQ_CONTRACT_FAILURE_PROBE=1 uv run --offline pytest -q -W error tests/test_issue_snapshot.py >/dev/null 2>&1)
probe_status=$?
set -e

if [[ $probe_status -eq 0 ]]; then
  printf '%s\n' "Contract failure probe unexpectedly passed." >&2
  exit 1
fi

printf '%s\n' "Contract failure probe detected the expected test failure."
