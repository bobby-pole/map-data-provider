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

const snapshotPath = path.join(root, "snapshot_manifest.json");
if (!fs.existsSync(snapshotPath)) {
  throw new Error("Missing checksum-validated prepared snapshot manifest");
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
  !/^[a-f0-9]{64}$/.test(snapshotChecksum ?? "") ||
  crypto.createHash("sha256").update(canonicalJson(unsignedSnapshot)).digest("hex") !==
    snapshotChecksum
) {
  throw new Error("Prepared snapshot manifest is invalid, not ready, or has a checksum mismatch");
}
const snapshotDomains = new Map(
  (snapshot.domain_outcomes ?? []).map((outcome) => [outcome.domain, outcome]),
);

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
const openStreetMapNotice = {
  source_id: "openstreetmap",
  license: "ODbL-1.0",
  license_url: "https://opendatacommons.org/licenses/odbl/1-0/",
  attribution: "© OpenStreetMap contributors",
  attribution_url: "https://www.openstreetmap.org/copyright",
  notice_path: "licenses/openstreetmap-odbl.md",
};
for (const domain of primaryDomains) {
  if (!manifest.domains?.includes(domain)) {
    throw new Error(`Missing primary domain: ${domain}`);
  }
  const outcome = snapshotDomains.get(domain);
  if (outcome?.status !== "ready" || !/^[a-f0-9]{64}$/.test(outcome.manifest_sha256 ?? "")) {
    throw new Error(`Prepared snapshot does not publish a ready checksum for ${domain}`);
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

for (const domain of primaryDomains) {
  const packRoot = path.join(root, domain, "domain-pack-v2");
  const packManifestPath = path.join(packRoot, "manifest.json");
  if (!fs.existsSync(packManifestPath)) {
    throw new Error(`Missing domain-pack manifest for ${domain}`);
  }
  const pack = JSON.parse(fs.readFileSync(packManifestPath, "utf8"));
  const manifestChecksum = crypto
    .createHash("sha256")
    .update(fs.readFileSync(packManifestPath))
    .digest("hex");
  const snapshotOutcome = snapshotDomains.get(domain);
  if (snapshotOutcome?.manifest_sha256 !== manifestChecksum) {
    throw new Error(`Prepared snapshot checksum does not match ${domain} domain pack.`);
  }
  const publicArtifacts = (pack.artifacts ?? []).filter(
    (artifact) => artifact.public_export === true,
  );
  for (const artifact of publicArtifacts) {
    if (!Array.isArray(artifact.source_provenance) || artifact.source_provenance.length === 0) {
      throw new Error(`Public artifact '${artifact.id}' in ${domain} has no source provenance.`);
    }
  }
  const publicSourceIds = new Set(
    publicArtifacts.flatMap((artifact) =>
      (artifact.source_provenance ?? []).map((record) => record.source_id),
    ),
  );
  for (const sourceId of publicSourceIds) {
    if (sourceId !== "openstreetmap") {
      throw new Error(
        `Public artifact in ${domain} uses '${sourceId}', which is not eligible for this demo bundle.`,
      );
    }
  }
  if (!publicSourceIds.has("openstreetmap")) continue;

  const noticeRecord = pack.data_license_notices?.[0];
  if (
    !Array.isArray(pack.data_license_notices) ||
    pack.data_license_notices.length !== 1 ||
    !Object.entries(openStreetMapNotice).every(([field, value]) => noticeRecord?.[field] === value)
  ) {
    throw new Error(`Public OpenStreetMap artifacts in ${domain} require the ODbL notice record.`);
  }
  const noticePath = path.resolve(packRoot, openStreetMapNotice.notice_path);
  if (!noticePath.startsWith(`${packRoot}${path.sep}`) || !fs.existsSync(noticePath)) {
    throw new Error(`Missing OpenStreetMap ODbL notice file for ${domain}`);
  }
  const bundleNoticePath = path.relative(root, noticePath).split(path.sep).join("/");
  if (!manifest.files?.[bundleNoticePath]) {
    throw new Error(
      `OpenStreetMap ODbL notice is not checksummed in the demo bundle for ${domain}`,
    );
  }
  const notice = fs.readFileSync(noticePath, "utf8");
  if (
    !notice.includes(openStreetMapNotice.license_url) ||
    !notice.includes(openStreetMapNotice.attribution_url)
  ) {
    throw new Error(`OpenStreetMap ODbL notice is incomplete for ${domain}`);
  }
}

console.log(
  `Verified ${Object.keys(manifest.files).length} files across ${manifest.domains.length} domains from bundle ${manifest.bundle_id}.`,
);
