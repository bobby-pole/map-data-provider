#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

set +e
(cd backend && MDQ_CONTRACT_FAILURE_PROBE=1 uv run pytest -q -W error tests/test_issue_snapshot.py >/dev/null 2>&1)
probe1_status=$?

(cd backend && MDQ_REJECT_NONFREE_PROBE=1 uv run pytest -q -W error tests/test_source_registry.py >/dev/null 2>&1)
probe2_status=$?

(cd backend && MDQ_REJECT_WMS_VECTOR_PROBE=1 uv run pytest -q -W error tests/test_source_registry.py >/dev/null 2>&1)
probe3_status=$?
set -e

if [[ $probe1_status -eq 0 || $probe2_status -eq 0 || $probe3_status -eq 0 ]]; then
  printf '%s\n' "One or more failure probes unexpectedly passed." >&2
  exit 1
fi

printf '%s\n' "All 3 failure probes (contract, non-free source, WMS vector) detected expected failures."
