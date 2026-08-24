#!/usr/bin/env bash
set -euo pipefail

# Build an operator-controlled demo bundle outside the repository. The source
# may be an existing local prepared cache; the output is the only directory
# that should be copied to the VPS.
SOURCE_DIR="${1:-backend/data/cache/rybnik_35km}"
OUTPUT_ROOT="${2:-.mdq-demo-bundle}"
BUNDLE_ID="${3:-${MDQ_DEMO_BUNDLE_ID:-}}"

if [[ ! -d "${SOURCE_DIR}" ]]; then
  echo "Error: Source directory ${SOURCE_DIR} does not exist." >&2
  exit 1
fi
if [[ -z "${BUNDLE_ID}" ]]; then
  echo "Error: provide an immutable bundle id as the third argument or MDQ_DEMO_BUNDLE_ID." >&2
  exit 1
fi

OUTPUT_DIR="${OUTPUT_ROOT}/rybnik_35km"
SOURCE_ABS="$(cd "${SOURCE_DIR}" && pwd)"
mkdir -p "$(dirname "${OUTPUT_DIR}")"
OUTPUT_PARENT="$(cd "$(dirname "${OUTPUT_DIR}")" && pwd)"
OUTPUT_ABS="${OUTPUT_PARENT}/$(basename "${OUTPUT_DIR}")"
case "${OUTPUT_ABS}" in
  "${SOURCE_ABS}"|"${SOURCE_ABS}"/*)
    echo "Error: output must be outside the source directory." >&2
    exit 1
    ;;
esac
if [[ "${SOURCE_ABS}" == "${OUTPUT_ABS}" ]]; then
  echo "Error: output must be outside the source directory." >&2
  exit 1
fi

rm -rf "${OUTPUT_DIR}"
mkdir -p "${OUTPUT_DIR}"

node -e '
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const sourceDir = path.resolve(process.argv[1]);
const outputDir = path.resolve(process.argv[2]);
const bundleId = process.argv[3];

function copyTree(source, target) {
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.name === "demo_bundle_manifest.json" || entry.name.startsWith(".")) continue;
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(targetPath, { recursive: true });
      copyTree(sourcePath, targetPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(sourcePath, targetPath);
    }
  }
}

function walk(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(fullPath));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

copyTree(sourceDir, outputDir);
const fileEntries = {};
const domains = new Set();
for (const filePath of walk(outputDir)) {
  const relPath = path.relative(outputDir, filePath).split(path.sep).join("/");
  domains.add(relPath.split("/")[0]);
  const content = fs.readFileSync(filePath);
  fileEntries[relPath] = {
    sha256: crypto.createHash("sha256").update(content).digest("hex"),
    size_bytes: content.length,
  };
}

const manifest = {
  demo_bundle_version: "mdq_demo_bundle/v1",
  bundle_id: bundleId,
  aoi_id: "rybnik_35km",
  domains: Array.from(domains).sort(),
  files: fileEntries,
};
fs.writeFileSync(path.join(outputDir, "demo_bundle_manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Demo bundle ${bundleId} prepared at ${outputDir} (${Object.keys(fileEntries).length} files).`);
' "${SOURCE_DIR}" "${OUTPUT_DIR}" "${BUNDLE_ID}"
