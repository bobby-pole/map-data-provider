#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

probe1_file=$(mktemp)
probe2_file=$(mktemp)
probe3_file=$(mktemp)
probe4_file=$(mktemp)
probe5_file=$(mktemp)
probe6_file=$(mktemp)

trap 'rm -f "$probe1_file" "$probe2_file" "$probe3_file" "$probe4_file" "$probe5_file" "$probe6_file"' EXIT

(
  set +e
  (cd backend && MDQ_CONTRACT_FAILURE_PROBE=1 uv run pytest -q -W error tests/test_issue_snapshot.py >/dev/null 2>&1)
  echo $? > "$probe1_file"
) &
pid1=$!

(
  set +e
  (cd backend && MDQ_REJECT_NONFREE_PROBE=1 uv run pytest -q -W error tests/test_source_registry.py >/dev/null 2>&1)
  echo $? > "$probe2_file"
) &
pid2=$!

(
  set +e
  (cd backend && MDQ_REJECT_WMS_VECTOR_PROBE=1 uv run pytest -q -W error tests/test_source_registry.py >/dev/null 2>&1)
  echo $? > "$probe3_file"
) &
pid3=$!

(
  set +e
  (cd backend && MDQ_REJECT_STALE_EVIDENCE_PROBE=1 uv run pytest -q -W error tests/test_source_registry.py >/dev/null 2>&1)
  echo $? > "$probe4_file"
) &
pid4=$!

(
  set +e
  (cd backend && MDQ_REJECT_MALFORMED_PACK_PROBE=1 uv run pytest -q -W error tests/test_domain_pack.py >/dev/null 2>&1)
  echo $? > "$probe5_file"
) &
pid5=$!

(
  set +e
  (cd backend-node && MDQ_REJECT_MALFORMED_EXPORT_PROBE=1 pnpm vitest run src/routes/aoi.test.ts >/dev/null 2>&1)
  echo $? > "$probe6_file"
) &
pid6=$!

wait $pid1 $pid2 $pid3 $pid4 $pid5 $pid6 2>/dev/null || true

probe1_status=$(cat "$probe1_file" 2>/dev/null || echo 0)
probe2_status=$(cat "$probe2_file" 2>/dev/null || echo 0)
probe3_status=$(cat "$probe3_file" 2>/dev/null || echo 0)
probe4_status=$(cat "$probe4_file" 2>/dev/null || echo 0)
probe5_status=$(cat "$probe5_file" 2>/dev/null || echo 0)
probe6_status=$(cat "$probe6_file" 2>/dev/null || echo 0)

if [[ $probe1_status -eq 0 || $probe2_status -eq 0 || $probe3_status -eq 0 || $probe4_status -eq 0 || $probe5_status -eq 0 || $probe6_status -eq 0 ]]; then
  printf '%s\n' "One or more failure probes unexpectedly passed (p1=$probe1_status, p2=$probe2_status, p3=$probe3_status, p4=$probe4_status, p5=$probe5_status, p6=$probe6_status)." >&2
  exit 1
fi

printf '%s\n' "All 6 failure probes (contract, non-free source, WMS vector, stale evidence, malformed pack, malformed export query) detected expected failures."
