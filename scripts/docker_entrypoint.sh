#!/usr/bin/env bash
set -euo pipefail

PREPARED_ROOT="${MDQ_PREPARED_ROOT:-/app/data/prepared}"
REVIEW_ROOT="${MDQ_REVIEW_ROOT:-/app/data/reviews}"
RUNTIME_ROOT="${MDQ_RUNTIME_ROOT:-/app/data/runtime}"
BUNDLE_SOURCE="${MDQ_BUNDLE_SOURCE:-/app/data/bundle/rybnik_35km}"
REQUIRE_DEMO_BUNDLE="${MDQ_REQUIRE_DEMO_BUNDLE:-true}"
EXPECTED_BUNDLE_ID="${MDQ_DEMO_BUNDLE_ID:-}"

echo "==> Initializing Map Data Provider container..."
echo "    Prepared storage:   ${PREPARED_ROOT}"
echo "    Review storage:     ${REVIEW_ROOT}"
echo "    Runtime storage:    ${RUNTIME_ROOT}"
echo "    Runtime mode:       ${MDQ_RUNTIME_MODE:-disabled}"

mkdir -p "${PREPARED_ROOT}" "${REVIEW_ROOT}" "${RUNTIME_ROOT}"
# A killed or concurrently restarted bootstrap can leave a complete temporary
# copy behind. It is not a published snapshot and may be removed once stale;
# a recent stage remains protected in case another bootstrap is still running.
find "${PREPARED_ROOT}" -mindepth 1 -maxdepth 1 -type d -name '.bootstrap_stage_*' -mmin +60 -exec rm -rf -- {} +

if [[ ! -f "${REVIEW_ROOT}/issue-reviews.json" ]]; then
  echo "==> Initializing empty issue review store..."
  printf '%s\n' '{"review_store_version":"provider_issue_reviews/v1","reviews":[]}' > "${REVIEW_ROOT}/issue-reviews.json"
fi

verify_bundle() {
  local bundle_dir="$1"

  node -e '
    const fs = require("fs");
    const path = require("path");
    const crypto = require("crypto");

    const bundleDir = process.argv[1];
    const expectedBundleId = process.argv[2];
    const manifestPath = path.join(bundleDir, "demo_bundle_manifest.json");
    if (!fs.existsSync(manifestPath)) {
      console.error("ERROR: Demo bundle manifest not found");
      process.exit(1);
    }

    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (manifest.demo_bundle_version !== "mdq_demo_bundle/v1") {
      console.error(`ERROR: Unsupported demo bundle version: ${manifest.demo_bundle_version}`);
      process.exit(1);
    }
    if (manifest.aoi_id !== "rybnik_35km") {
      console.error(`ERROR: Unsupported demo AOI: ${manifest.aoi_id}`);
      process.exit(1);
    }
    if (!manifest.bundle_id || (expectedBundleId && manifest.bundle_id !== expectedBundleId)) {
      console.error(`ERROR: Demo bundle id mismatch. Expected ${expectedBundleId || "a declared id"}, got ${manifest.bundle_id || "<missing>"}`);
      process.exit(1);
    }
    if (!manifest.files || typeof manifest.files !== "object") {
      console.error("ERROR: Invalid manifest files dictionary");
      process.exit(1);
    }

    const snapshotPath = path.join(bundleDir, "snapshot_manifest.json");
    if (!fs.existsSync(snapshotPath) || !manifest.files["snapshot_manifest.json"]) {
      console.error("ERROR: Demo bundle is missing its prepared snapshot manifest");
      process.exit(1);
    }
    const snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
    const { checksum: snapshotChecksum, ...unsignedSnapshot } = snapshot;
    const canonicalJson = (value) => {
      if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
      if (value && typeof value === "object") {
        return `{${Object.keys(value)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
          .join(",")}}`;
      }
      return JSON.stringify(value);
    };
    if (
      snapshot.snapshot_version !== "provider_prepared_snapshot/v1" ||
      snapshot.aoi_id !== manifest.aoi_id ||
      snapshot.snapshot_id !== manifest.aoi_id ||
      snapshot.state !== "ready" ||
      !/^[a-f0-9]{64}$/.test(snapshotChecksum || "") ||
      crypto.createHash("sha256").update(canonicalJson(unsignedSnapshot)).digest("hex") !== snapshotChecksum
    ) {
      console.error("ERROR: Prepared snapshot is invalid, not ready, or has a checksum mismatch");
      process.exit(1);
    }
    const snapshotDomains = new Map((snapshot.domain_outcomes || []).map((outcome) => [outcome.domain, outcome]));

    const root = fs.realpathSync(bundleDir);
    let verifiedCount = 0;
    for (const [relPath, fileInfo] of Object.entries(manifest.files)) {
      if (path.isAbsolute(relPath) || relPath.includes("..") || relPath.startsWith("/")) {
        console.error(`ERROR: Unsafe manifest path: ${relPath}`);
        process.exit(1);
      }
      const fullPath = path.resolve(bundleDir, relPath);
      if (!fullPath.startsWith(`${root}${path.sep}`) || !fs.existsSync(fullPath)) {
        console.error(`ERROR: Missing or unsafe file declared in manifest: ${relPath}`);
        process.exit(1);
      }
      const resolvedPath = fs.realpathSync(fullPath);
      if (!resolvedPath.startsWith(`${root}${path.sep}`)) {
        console.error(`ERROR: Symlink escapes demo bundle: ${relPath}`);
        process.exit(1);
      }
      const stat = fs.statSync(resolvedPath);
      if (!stat.isFile() || stat.size !== fileInfo.size_bytes) {
        console.error(`ERROR: Size/type mismatch for ${relPath}`);
        process.exit(1);
      }
      const sha256 = crypto.createHash("sha256").update(fs.readFileSync(resolvedPath)).digest("hex");
      if (sha256 !== fileInfo.sha256) {
        console.error(`ERROR: Checksum mismatch for ${relPath}`);
        process.exit(1);
      }
      verifiedCount++;
    }

    for (const domain of manifest.domains || []) {
      const packManifestPath = path.join(bundleDir, domain, "domain-pack-v2", "manifest.json");
      if (!fs.existsSync(packManifestPath)) {
        console.error(`ERROR: Missing domain-pack manifest for ${domain}`);
        process.exit(1);
      }
      const packManifest = JSON.parse(fs.readFileSync(packManifestPath, "utf8"));
      if (packManifest.domain_pack_version !== "provider_domain_pack/v2") {
        console.error(`ERROR: Invalid domain pack version in ${domain}`);
        process.exit(1);
      }
      const outcome = snapshotDomains.get(domain);
      const manifestChecksum = crypto.createHash("sha256").update(fs.readFileSync(packManifestPath)).digest("hex");
      if (outcome?.status !== "ready" || outcome.manifest_sha256 !== manifestChecksum) {
        console.error(`ERROR: Prepared snapshot does not validate domain pack ${domain}`);
        process.exit(1);
      }
    }

    console.log(`==> Verified ${verifiedCount} files across ${manifest.domains?.length || 0} domains in bundle ${manifest.bundle_id}`);
  ' "${bundle_dir}" "${EXPECTED_BUNDLE_ID}"
}

if [[ ! -d "${PREPARED_ROOT}/rybnik_35km" ]]; then
  if [[ ! -f "${BUNDLE_SOURCE}/demo_bundle_manifest.json" ]]; then
    if [[ "${REQUIRE_DEMO_BUNDLE}" == "true" ]]; then
      echo "ERROR: Required demo bundle is missing at ${BUNDLE_SOURCE}" >&2
      exit 1
    fi
    echo "==> Demo bundle is optional and was not provided."
  else
    echo "==> Found demo bundle at ${BUNDLE_SOURCE}. Starting checksummed bootstrap..."
    TMP_STAGE=$(mktemp -d "${PREPARED_ROOT}/.bootstrap_stage_XXXXXX")
    trap 'rm -rf "${TMP_STAGE}"' EXIT
    # The externally provisioned bundle is deliberately immutable. Do not
    # preserve its read-only modes in mutable prepared storage: this process
    # runs as appuser and must be able to promote and remove its own stage.
    cp -R --no-preserve=mode,ownership "${BUNDLE_SOURCE}" "${TMP_STAGE}/rybnik_35km"
    chmod -R u=rwX "${TMP_STAGE}/rybnik_35km"
    verify_bundle "${TMP_STAGE}/rybnik_35km"
    mv "${TMP_STAGE}/rybnik_35km" "${PREPARED_ROOT}/rybnik_35km"
    rm -rf "${TMP_STAGE}"
    trap - EXIT
    echo "==> Baseline Rybnik 35km cache bootstrap successfully completed."
  fi
else
  if [[ -z "${EXPECTED_BUNDLE_ID}" ]]; then
    echo "ERROR: MDQ_DEMO_BUNDLE_ID must be set when prepared data already exists" >&2
    exit 1
  fi
  verify_bundle "${PREPARED_ROOT}/rybnik_35km"
fi

echo "==> Starting Map Data Provider on port ${PORT:-3001}..."
exec node /app/backend-node/dist/server.js
