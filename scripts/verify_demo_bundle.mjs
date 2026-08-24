import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const bundleDirectory = process.argv[2];
if (!bundleDirectory) {
  throw new Error("Usage: node scripts/verify_demo_bundle.mjs <rybnik_35km-bundle-directory>");
}

const root = fs.realpathSync(bundleDirectory);
const manifestPath = path.join(root, "demo_bundle_manifest.json");
if (!fs.existsSync(manifestPath)) {
  throw new Error("Missing demo_bundle_manifest.json");
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (manifest.demo_bundle_version !== "mdq_demo_bundle/v1" || manifest.aoi_id !== "rybnik_35km") {
  throw new Error("Unsupported demo bundle identity");
}

const primaryDomains = [
  "power",
  "emergency",
  "public",
  "transport",
  "bridges",
  "water",
  "gas",
  "sewer",
  "industrial",
];
for (const domain of primaryDomains) {
  if (!manifest.domains?.includes(domain)) {
    throw new Error(`Missing primary domain: ${domain}`);
  }
}

for (const [relativePath, file] of Object.entries(manifest.files ?? {})) {
  if (path.isAbsolute(relativePath) || relativePath.includes("..")) {
    throw new Error(`Unsafe manifest path: ${relativePath}`);
  }
  const candidate = path.resolve(root, relativePath);
  if (!candidate.startsWith(`${root}${path.sep}`) || !fs.existsSync(candidate)) {
    throw new Error(`Missing file: ${relativePath}`);
  }
  const bytes = fs.readFileSync(candidate);
  if (
    bytes.length !== file.size_bytes ||
    crypto.createHash("sha256").update(bytes).digest("hex") !== file.sha256
  ) {
    throw new Error(`Checksum mismatch: ${relativePath}`);
  }
}

console.log(
  `Verified ${Object.keys(manifest.files).length} files across ${manifest.domains.length} domains from bundle ${manifest.bundle_id}.`,
);
