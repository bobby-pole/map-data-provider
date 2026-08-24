#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOCAL_BUNDLE_ROOT="${MDQ_LOCAL_BUNDLE_ROOT:-${PROJECT_ROOT}/.local-demo-bundle}"
MANIFEST_PATH="${LOCAL_BUNDLE_ROOT}/rybnik_35km/demo_bundle_manifest.json"

if [[ ! -f "${MANIFEST_PATH}" ]]; then
  echo "Missing local Rybnik demo bundle: ${MANIFEST_PATH}" >&2
  echo "Run scripts/pull_local_demo_bundle.sh <bundle-directory> first." >&2
  exit 1
fi

node "${PROJECT_ROOT}/scripts/verify_demo_bundle.mjs" "${LOCAL_BUNDLE_ROOT}/rybnik_35km"

export MDQ_PREPARED_ROOT="${LOCAL_BUNDLE_ROOT}"
export MDQ_DEMO_MODE=readonly
export MDQ_RUNTIME_ACQUISITION_ENABLED=false

exec pnpm --dir "${PROJECT_ROOT}/backend-node" run dev
