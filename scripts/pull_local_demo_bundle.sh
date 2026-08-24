#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_BUNDLE="${1:?Usage: $0 <local-or-remote-rybnik_35km-bundle-directory>}"
LOCAL_BUNDLE_ROOT="${MDQ_LOCAL_BUNDLE_ROOT:-${PROJECT_ROOT}/.local-demo-bundle}"
TARGET_BUNDLE="${LOCAL_BUNDLE_ROOT}/rybnik_35km"
mkdir -p "${LOCAL_BUNDLE_ROOT}"
STAGING_ROOT="$(mktemp -d "${LOCAL_BUNDLE_ROOT}/.import_stage_XXXXXX")"

cleanup() {
  chmod -R u+w "${STAGING_ROOT}" 2>/dev/null || true
  rm -rf "${STAGING_ROOT}"
}
trap cleanup EXIT

if [[ -e "${TARGET_BUNDLE}" ]]; then
  echo "Refusing to overwrite existing local bundle: ${TARGET_BUNDLE}" >&2
  echo "Remove or move it deliberately before importing a replacement." >&2
  exit 1
fi

rsync -a "${SOURCE_BUNDLE%/}/" "${STAGING_ROOT}/rybnik_35km/"

node "${PROJECT_ROOT}/scripts/verify_demo_bundle.mjs" "${STAGING_ROOT}/rybnik_35km"

mv "${STAGING_ROOT}/rybnik_35km" "${TARGET_BUNDLE}"
echo "Local demo bundle installed at ${TARGET_BUNDLE}"
