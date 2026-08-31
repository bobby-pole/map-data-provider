import { createHash } from "node:crypto";
import { type Dirent } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  type AoiAvailabilityResponse,
  aoiAvailabilityResponseSchema,
  type PreparedSnapshotManifest,
  preparedSnapshotManifestSchema,
  type RuntimeAcquisitionEvidence,
  runtimeAcquisitionEvidenceSchema,
} from "../types/provider.js";
import { ProviderDataError, type ProviderDataPaths } from "./providerDataService.js";

/** Read-only access to operator-published snapshot metadata.
 *
 * Snapshot manifests live beside their validated domain packs at
 * `${MDQ_PREPARED_ROOT}/{aoi_id}/snapshot_manifest.json`.  The checksum is a
 * canonical digest of the manifest without `checksum`, so a partially copied
 * or hand-edited publication is rejected before it can be advertised.
 */
export async function listPreparedSnapshots(
  paths?: ProviderDataPaths,
): Promise<PreparedSnapshotManifest[]> {
  const root = preparedRoot(paths);
  let entries: Dirent[];
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (isMissing(error)) {
      return [];
    }
    throw error;
  }

  const snapshots = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory() && identifier.test(entry.name))
      .map(async (entry) => readPreparedSnapshot(path.join(root, entry.name))),
  );
  return snapshots.filter((snapshot): snapshot is PreparedSnapshotManifest => snapshot !== null);
}

export async function getPreparedSnapshot(
  aoiId: string,
  paths?: ProviderDataPaths,
): Promise<PreparedSnapshotManifest> {
  assertIdentifier(aoiId, "AOI");
  const snapshot = await readPreparedSnapshot(path.join(preparedRoot(paths), aoiId));
  if (!snapshot) {
    throw new ProviderDataError("not_found", `No published snapshot exists for AOI '${aoiId}'.`);
  }
  if (snapshot.aoi_id !== aoiId) {
    throw new ProviderDataError(
      "invalid_request",
      "Prepared snapshot identity does not match its path.",
    );
  }
  return snapshot;
}

export async function getRuntimeAcquisitionEvidence(
  aoiId: string,
  paths?: ProviderDataPaths,
): Promise<RuntimeAcquisitionEvidence> {
  const snapshot = await getPreparedSnapshot(aoiId, paths);
  let raw: unknown;
  try {
    raw = JSON.parse(
      await readFile(path.join(preparedRoot(paths), aoiId, "acquisition_evidence.json"), "utf8"),
    );
  } catch (error) {
    if (isMissing(error)) {
      throw new ProviderDataError(
        "not_found",
        `No runtime acquisition evidence is published for snapshot '${snapshot.snapshot_id}'.`,
      );
    }
    throw new ProviderDataError("invalid_request", "Runtime acquisition evidence is malformed.");
  }
  const evidence = runtimeAcquisitionEvidenceSchema.parse(raw);
  if (evidence.aoi_id !== aoiId || evidence.snapshot_id !== snapshot.snapshot_id) {
    throw new ProviderDataError(
      "invalid_request",
      "Runtime acquisition evidence identity does not match its snapshot.",
    );
  }
  return evidence;
}

export function availabilityForResolvedAoi(
  requested: { aoi_id: string; geometry: unknown },
  snapshots: PreparedSnapshotManifest[],
): AoiAvailabilityResponse {
  const exact = snapshots.filter((snapshot) => snapshot.aoi_id === requested.aoi_id);
  const matchingIds = exact.map((snapshot) => snapshot.snapshot_id);
  const limitations = exact.flatMap((snapshot) => snapshot.coverage.limitations);
  const ready = exact.find((snapshot) => snapshot.state === "ready");
  if (ready) {
    return aoiAvailabilityResponseSchema.parse({
      response_version: "provider_aoi_availability/v1",
      requested_aoi_id: requested.aoi_id,
      state: "ready",
      snapshot_ids: [ready.snapshot_id],
      explanation: "A checksum-validated prepared snapshot exactly matches the resolved AOI.",
      limitations: ready.coverage.limitations,
    });
  }
  const inProgress = exact.find(
    (snapshot) => snapshot.state === "running" || snapshot.state === "queued",
  );
  if (inProgress) {
    return aoiAvailabilityResponseSchema.parse({
      response_version: "provider_aoi_availability/v1",
      requested_aoi_id: requested.aoi_id,
      state: inProgress.state,
      snapshot_ids: matchingIds,
      explanation: `The exact AOI snapshot is ${inProgress.state}; no unpublished domain is presented as ready.`,
      limitations,
    });
  }
  const failed = exact.find((snapshot) => snapshot.state === "failed");
  if (failed) {
    return aoiAvailabilityResponseSchema.parse({
      response_version: "provider_aoi_availability/v1",
      requested_aoi_id: requested.aoi_id,
      state: "failed",
      snapshot_ids: matchingIds,
      explanation:
        "The exact AOI snapshot failed; the previous published snapshot, if any, remains unchanged.",
      limitations,
    });
  }
  const partial = exact.find((snapshot) => snapshot.state === "partial");
  if (partial) {
    return aoiAvailabilityResponseSchema.parse({
      response_version: "provider_aoi_availability/v1",
      requested_aoi_id: requested.aoi_id,
      state: "partial_coverage",
      snapshot_ids: matchingIds,
      explanation:
        "The exact AOI has a published partial snapshot; failed domain outcomes remain explicit.",
      limitations,
    });
  }

  // We deliberately do not infer full coverage from a bounding box or a
  // geometry proximity. That would overclaim coverage at concave/multipart
  // borders. A non-identical request can therefore only be reported as an
  // explicitly partial candidate when its bounding box overlaps a publication.
  const requestedBounds = bounds(requested.geometry);
  const overlapping = requestedBounds
    ? snapshots.filter((snapshot) => {
        const snapshotBounds = bounds(snapshot.coverage.geometry);
        return snapshotBounds !== null && boxesOverlap(requestedBounds, snapshotBounds);
      })
    : [];
  if (overlapping.length > 0) {
    return aoiAvailabilityResponseSchema.parse({
      response_version: "provider_aoi_availability/v1",
      requested_aoi_id: requested.aoi_id,
      state: "partial_coverage",
      snapshot_ids: overlapping.map((snapshot) => snapshot.snapshot_id),
      explanation:
        "Prepared snapshot bounds overlap this non-identical AOI. Exact coverage is not claimed; prepare a matching snapshot before using it as complete coverage.",
      limitations: overlapping.flatMap((snapshot) => snapshot.coverage.limitations),
    });
  }
  return aoiAvailabilityResponseSchema.parse({
    response_version: "provider_aoi_availability/v1",
    requested_aoi_id: requested.aoi_id,
    state: "not_prepared",
    snapshot_ids: [],
    explanation: "No checksum-validated prepared snapshot covers the resolved AOI.",
    limitations: [],
  });
}

async function readPreparedSnapshot(directory: string): Promise<PreparedSnapshotManifest | null> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(path.join(directory, "snapshot_manifest.json"), "utf8"));
  } catch (error) {
    if (isMissing(error)) {
      return null;
    }
    throw new ProviderDataError("invalid_request", "Prepared snapshot manifest is malformed.");
  }
  const snapshot = preparedSnapshotManifestSchema.parse(raw);
  const { checksum, ...unsigned } = snapshot;
  if (checksum !== digest(unsigned)) {
    throw new ProviderDataError(
      "invalid_request",
      "Prepared snapshot manifest checksum does not match.",
    );
  }
  await verifyPublishedDomainManifests(directory, snapshot);
  return snapshot;
}

async function verifyPublishedDomainManifests(
  directory: string,
  snapshot: PreparedSnapshotManifest,
): Promise<void> {
  for (const outcome of snapshot.domain_outcomes) {
    if (outcome.status !== "ready") {
      continue;
    }
    if (!outcome.manifest_sha256) {
      throw new ProviderDataError(
        "invalid_request",
        `Prepared snapshot '${snapshot.snapshot_id}' has a ready domain without a manifest checksum.`,
      );
    }
    let bytes: Buffer;
    try {
      bytes = await readFile(
        path.join(directory, outcome.domain, "domain-pack-v2", "manifest.json"),
      );
    } catch (error) {
      if (isMissing(error)) {
        throw new ProviderDataError(
          "not_found",
          `Prepared snapshot '${snapshot.snapshot_id}' is missing the '${outcome.domain}' domain pack.`,
        );
      }
      throw error;
    }
    if (createHash("sha256").update(bytes).digest("hex") !== outcome.manifest_sha256) {
      throw new ProviderDataError(
        "invalid_request",
        `Prepared snapshot '${snapshot.snapshot_id}' has a checksum mismatch for '${outcome.domain}'.`,
      );
    }
  }
}

function preparedRoot(paths?: ProviderDataPaths): string {
  return (
    paths?.cacheRoot ??
    process.env.MDQ_PREPARED_ROOT ??
    process.env.MDQ_CACHE_ROOT ??
    "backend/data/cache"
  );
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

type Bounds = [number, number, number, number];
function bounds(geometry: unknown): Bounds | null {
  if (!geometry || typeof geometry !== "object" || !("coordinates" in geometry)) {
    return null;
  }
  const values: number[] = [];
  const collect = (value: unknown): void => {
    if (!Array.isArray(value)) {
      return;
    }
    if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number") {
      values.push(value[0], value[1]);
      return;
    }
    value.forEach(collect);
  };
  collect(geometry.coordinates);
  if (values.length < 2) {
    return null;
  }
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (let index = 0; index < values.length; index += 2) {
    const x = values[index];
    const y = values[index + 1];
    if (x === undefined || y === undefined) {
      continue;
    }
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : null;
}

function boxesOverlap(left: Bounds, right: Bounds): boolean {
  return left[0] <= right[2] && right[0] <= left[2] && left[1] <= right[3] && right[1] <= left[3];
}

const identifier = /^[a-z0-9_]+$/;
function assertIdentifier(value: string, label: string): void {
  if (!identifier.test(value)) {
    throw new ProviderDataError("invalid_request", `${label} identifier is invalid.`);
  }
}
function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
