import { execFile } from "node:child_process";
import { open, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import type { z } from "zod";

import {
  domainPackV2Schema,
  type MapCircuitDetailResponse,
  mapCircuitDetailResponseSchema,
  type MapCircuitListResponse,
  mapCircuitListResponseSchema,
  type MapFeatureDetailResponse,
  mapFeatureDetailResponseSchema,
  type MapPresentationManifest,
  mapPresentationManifestSchema,
  type MapPresentationResponse,
  mapPresentationResponseSchema,
  powerCircuitEvidencePayloadSchema,
  providerIdentifierSchema,
  providerLayerResponseSchema,
  sourceRegistryV2Schema,
} from "../types/provider.js";
import { canonicalJson, sha256Hex } from "../utils/canonicalJson.js";
import {
  assertDataLicenseNoticeFiles,
  assertSafePackPaths,
  cacheRootFor,
  defaultCacheRoot,
  isAnalyticalGeoJsonArtifact,
  isMissingFile,
  notFound,
  packDirectoryName,
  projectRoot,
  ProviderDataError,
  type ProviderDataPaths,
  readBytes,
  readJson,
  registryPathFor,
  resolvePackPath,
  validateIdentifier,
  validatePackProvenance,
} from "./providerPaths.js";
import { runtimePythonExecutable } from "./runtimePython.js";

const verifiedMapArchives = new Map<string, { size: number; modifiedAt: number; sha256: string }>();
const execFileAsync = promisify(execFile);
const circuitRecoveryByFeature = new Map<string, Promise<void>>();
const circuitRecoveryByAoi = new Map<string, Promise<void>>();

export type MapPresentationArchiveRange = {
  bytes: Buffer;
  totalSize: number;
  start: number;
  end: number;
  etag: string;
};

export type MapPresentationArchiveInfo = {
  archivePath: string;
  totalSize: number;
  etag: string;
};

type PowerCircuitEvidence = {
  relation_id: string;
  tags: Record<string, string>;
  aoi_coverage: "bounded_source_snapshot";
  limitations: string[];
  members: Array<{
    source_id: string;
    role: string;
    availability?: string;
    endpoint_evidence?: { start: string; end: string };
    geometry?: { type: "LineString"; coordinates: [number, number][] };
  }>;
};

type PowerCircuitEvidencePayload =
  | {
      relations: PowerCircuitEvidence[];
      reverse_member_index: Record<string, string[]>;
      availability?: never;
      limitations?: never;
    }
  | {
      relations: PowerCircuitEvidence[];
      reverse_member_index: Record<string, string[]>;
      availability: "unavailable";
      limitations: string[];
    };

export async function getMapPresentations(
  aoiId: string,
  dataPaths?: ProviderDataPaths,
): Promise<MapPresentationResponse[]> {
  validateIdentifier(aoiId, "AOI");
  const aoiRoot = path.join(cacheRootFor(dataPaths), aoiId);
  let entries;
  try {
    entries = await readdir(aoiRoot, { withFileTypes: true });
  } catch (error) {
    if (isMissingFile(error)) {
      throw notFound(`No cached map presentations exist for AOI '${aoiId}'.`);
    }
    throw error;
  }
  const presentations = await Promise.all(
    entries
      .filter(
        (entry) => entry.isDirectory() && providerIdentifierSchema.safeParse(entry.name).success,
      )
      .map((entry) =>
        getMapPresentation(aoiId, entry.name, dataPaths).catch((error: unknown) => {
          if (
            error instanceof ProviderDataError &&
            error.kind === "not_found" &&
            error.message.startsWith("Missing map presentation manifest")
          ) {
            return null;
          }
          throw error;
        }),
      ),
  );
  const available = presentations
    .filter((presentation): presentation is MapPresentationResponse => presentation !== null)
    .sort((left, right) => left.domain.localeCompare(right.domain));
  if (available.length === 0) {
    throw notFound(`No cached map presentations exist for AOI '${aoiId}'.`);
  }
  return available;
}

export async function getMapPresentation(
  aoiId: string,
  domain: string,
  dataPaths?: ProviderDataPaths,
): Promise<MapPresentationResponse> {
  const { presentation } = await validatedMapPresentation(aoiId, domain, dataPaths);
  return mapPresentationResponseSchema.parse({
    ...presentation,
    response_version: "provider_map_presentation_read/v1",
    archive_url: `/api/aoi/${aoiId}/presentations/${domain}/archive`,
  });
}

export async function getMapPresentationArchiveRange(
  aoiId: string,
  domain: string,
  rangeHeader: string | undefined,
  dataPaths?: ProviderDataPaths,
  archiveInfo?: MapPresentationArchiveInfo,
): Promise<MapPresentationArchiveRange> {
  const archive = archiveInfo ?? (await getMapPresentationArchiveInfo(aoiId, domain, dataPaths));
  const range = parseSingleRange(rangeHeader, archive.totalSize);
  const handle = await open(archive.archivePath, "r");
  try {
    const bytes = Buffer.alloc(range.end - range.start + 1);
    await handle.read(bytes, 0, bytes.length, range.start);
    return { ...range, bytes, totalSize: archive.totalSize, etag: archive.etag };
  } finally {
    await handle.close();
  }
}

export async function getMapPresentationArchiveInfo(
  aoiId: string,
  domain: string,
  dataPaths?: ProviderDataPaths,
): Promise<MapPresentationArchiveInfo> {
  const { presentation, archivePath } = await validatedMapPresentation(aoiId, domain, dataPaths);
  return {
    archivePath,
    totalSize: presentation.archive.size_bytes,
    etag: `"${presentation.archive.sha256}"`,
  };
}

export async function getMapFeatureDetail(
  aoiId: string,
  domain: string,
  sourceId: string,
  dataPaths?: ProviderDataPaths,
): Promise<MapFeatureDetailResponse> {
  if (!/^[a-z][a-z0-9_-]*\/[A-Za-z0-9._:-]+$/i.test(sourceId)) {
    throw new ProviderDataError(
      "invalid_request",
      "source_id must be a provider feature identifier.",
    );
  }
  const { manifest, packRoot } = await validatedMapPresentation(aoiId, domain, dataPaths);
  for (const artifact of manifest.artifacts.filter(isAnalyticalGeoJsonArtifact)) {
    const layer = providerLayerResponseSchema.parse(
      await readJson(resolvePackPath(packRoot, artifact.path), `public layer '${artifact.id}'`),
    );
    const feature = layer.features.find((candidate) => candidate.properties.source_id === sourceId);
    if (feature) {
      return mapFeatureDetailResponseSchema.parse({
        response_version: "provider_map_feature_detail/v1",
        aoi_id: aoiId,
        domain,
        artifact_id: artifact.id,
        source_id: sourceId,
        feature,
      });
    }
  }
  throw notFound(`No eligible public feature exists for source_id '${sourceId}'.`);
}

export async function getMapCircuitsForFeature(
  aoiId: string,
  domain: string,
  sourceId: string,
  dataPaths?: ProviderDataPaths,
): Promise<MapCircuitListResponse> {
  if (!/^(node|way|relation)\/\d+$/.test(sourceId)) {
    throw new ProviderDataError(
      "invalid_request",
      "source_id must be an OSM node, way or relation identifier.",
    );
  }
  // A reverse-index hit is useful only for a feature that is actually present
  // in the delivered AOI. This avoids exposing stale or out-of-scope evidence.
  await getMapFeatureDetail(aoiId, domain, sourceId, dataPaths);
  let evidence = await readPowerCircuitEvidence(aoiId, domain, dataPaths);
  if (evidence.availability === "unavailable") {
    try {
      await recoverPowerCircuitEvidence(aoiId, sourceId, dataPaths);
      evidence = await readPowerCircuitEvidence(aoiId, domain, dataPaths);
    } catch {
      return mapCircuitListResponseSchema.parse({
        response_version: "provider_map_circuit_list/v1",
        aoi_id: aoiId,
        domain,
        source_id: sourceId,
        state: "unavailable",
        circuits: [],
        limitations: evidence.limitations,
      });
    }
  }
  if (evidence.availability === "unavailable") {
    return mapCircuitListResponseSchema.parse({
      response_version: "provider_map_circuit_list/v1",
      aoi_id: aoiId,
      domain,
      source_id: sourceId,
      state: "unavailable",
      circuits: [],
      limitations: evidence.limitations,
    });
  }
  const ids = evidence.reverse_member_index[sourceId] ?? [];
  const byId = new Map(evidence.relations.map((relation) => [relation.relation_id, relation]));
  const circuits = ids
    .map((id) => byId.get(id))
    .filter((relation): relation is PowerCircuitEvidence => relation !== undefined);
  return mapCircuitListResponseSchema.parse({
    response_version: "provider_map_circuit_list/v1",
    aoi_id: aoiId,
    domain,
    source_id: sourceId,
    state: circuits.length ? "available" : "not_applicable",
    circuits: circuits.map((circuit) => ({
      relation_id: circuit.relation_id,
      tags: circuit.tags,
      aoi_coverage: circuit.aoi_coverage,
      member_count: circuit.members.length,
    })),
  });
}

export async function getMapCircuitDetail(
  aoiId: string,
  domain: string,
  circuitId: string,
  dataPaths?: ProviderDataPaths,
): Promise<MapCircuitDetailResponse> {
  if (!/^relation\/\d+$/.test(circuitId)) {
    throw new ProviderDataError(
      "invalid_request",
      "circuit_id must be an OSM relation identifier.",
    );
  }
  const evidence = await readPowerCircuitEvidence(aoiId, domain, dataPaths);
  const circuit = evidence.relations.find((candidate) => candidate.relation_id === circuitId);
  if (!circuit) {
    throw notFound(`No committed circuit exists for circuit_id '${circuitId}'.`);
  }
  return mapCircuitDetailResponseSchema.parse({
    response_version: "provider_map_circuit_detail/v1",
    aoi_id: aoiId,
    domain,
    circuit,
  });
}

async function readPowerCircuitEvidence(
  aoiId: string,
  domain: string,
  dataPaths?: ProviderDataPaths,
): Promise<PowerCircuitEvidencePayload> {
  const { manifest, packRoot } = await validatedMapPresentation(aoiId, domain, dataPaths);
  const artifact = manifest.artifacts.find(
    (candidate) => candidate.id === "power.osm_relation_evidence",
  );
  if (!artifact?.path || artifact.public_export || artifact.kind !== "native_vector") {
    throw new ProviderDataError("not_found", "Circuit evidence is unavailable.");
  }
  const bytes = await readBytes(resolvePackPath(packRoot, artifact.path), "circuit evidence");
  if (sha256Hex(bytes) !== artifact.sha256) {
    throw new ProviderDataError("not_found", "Circuit evidence checksum does not match.");
  }
  const raw = JSON.parse(bytes.toString("utf8")) as unknown;
  const parsed = powerCircuitEvidencePayloadSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ProviderDataError("not_found", "Circuit evidence has an invalid contract.");
  }
  return parsed.data;
}

async function recoverPowerCircuitEvidence(
  aoiId: string,
  sourceId: string,
  dataPaths?: ProviderDataPaths,
): Promise<void> {
  // Test fixtures can choose an isolated data root. A live recovery must never
  // write outside the runtime worker's canonical cache root.
  if (dataPaths?.cacheRoot) {
    throw new ProviderDataError(
      "not_found",
      "Circuit evidence recovery is unavailable for an isolated provider-data root.",
    );
  }
  const key = `${aoiId}:${sourceId}`;
  const existing = circuitRecoveryByFeature.get(key);
  if (existing) {
    return existing;
  }
  const previousForAoi = circuitRecoveryByAoi.get(aoiId) ?? Promise.resolve();
  const recovery = previousForAoi
    .catch(() => undefined)
    .then(async () => {
      const aoi = await runtimeAoiForId(aoiId);
      const script = [
        "from pathlib import Path",
        "import json, sys",
        "from geo_pipeline.runtime_osm import backfill_power_circuit_evidence_for_member",
        "result = backfill_power_circuit_evidence_for_member(aoi=json.loads(sys.argv[1]), source_id=sys.argv[2], root=Path(sys.argv[3]))",
        "print(json.dumps({'availability': result.get('availability', 'available')}))",
      ].join("\n");
      const backendDirectory = process.env.MDQ_BACKEND_DIR ?? path.join(projectRoot, "backend");
      await execFileAsync(
        runtimePythonExecutable(backendDirectory),
        ["-c", script, JSON.stringify(aoi), sourceId, defaultCacheRoot],
        {
          cwd: backendDirectory,
          timeout: 90_000,
          maxBuffer: 4 * 1024 * 1024,
        },
      );
    })
    .finally(() => {
      circuitRecoveryByFeature.delete(key);
      if (circuitRecoveryByAoi.get(aoiId) === recovery) {
        circuitRecoveryByAoi.delete(aoiId);
      }
    });
  circuitRecoveryByFeature.set(key, recovery);
  circuitRecoveryByAoi.set(aoiId, recovery);
  return recovery;
}

async function runtimeAoiForId(aoiId: string): Promise<unknown> {
  const runtimeRoot = process.env.MDQ_RUNTIME_ROOT ?? path.join(projectRoot, "backend", "cache");
  const stateRoot = path.join(runtimeRoot, "provider-runtime-v1");
  const entries = await readdir(stateRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      continue;
    }
    try {
      const payload = JSON.parse(await readFile(path.join(stateRoot, entry.name), "utf8")) as {
        aoi?: { aoi_id?: unknown };
      };
      if (payload.aoi?.aoi_id === aoiId) {
        return payload.aoi;
      }
    } catch {
      // A partial or unrelated runtime state cannot authorize a recovery.
    }
  }
  throw new ProviderDataError(
    "not_found",
    `No runtime AOI state exists for circuit recovery '${aoiId}'.`,
  );
}

async function validatedMapPresentation(
  aoiId: string,
  domain: string,
  dataPaths?: ProviderDataPaths,
): Promise<{
  presentation: MapPresentationManifest;
  archivePath: string;
  manifest: z.infer<typeof domainPackV2Schema>;
  packRoot: string;
}> {
  validateIdentifier(aoiId, "AOI");
  validateIdentifier(domain, "domain");
  const packRoot = path.join(cacheRootFor(dataPaths), aoiId, domain, packDirectoryName);
  const manifest = domainPackV2Schema.parse(
    await readJson(
      path.join(packRoot, "manifest.json"),
      `domain-pack manifest '${aoiId}/${domain}'`,
    ),
  );
  if (manifest.aoi_id !== aoiId || manifest.domain !== domain) {
    throw notFound("Domain-pack identity does not match the request.");
  }
  assertSafePackPaths(packRoot, manifest);
  await assertDataLicenseNoticeFiles(packRoot, manifest);
  const registry = sourceRegistryV2Schema.parse(
    await readJson(registryPathFor(dataPaths), "source registry"),
  );
  validatePackProvenance(manifest.source_provenance, registry, false);
  const presentationRoot = path.join(packRoot, "presentation");
  const presentation = mapPresentationManifestSchema.parse(
    await readJson(path.join(presentationRoot, "manifest.json"), "map presentation manifest"),
  );
  if (presentation.aoi_id !== aoiId || presentation.domain !== domain) {
    throw notFound("Map presentation identity does not match the request.");
  }
  if (presentation.parent_domain_pack.sha256 !== sha256Hex(canonicalJson(manifest))) {
    throw notFound("Map presentation is stale for the domain manifest.");
  }
  const publicArtifacts = new Map(
    manifest.artifacts
      .filter(isAnalyticalGeoJsonArtifact)
      .map((artifact) => [artifact.id, artifact]),
  );
  if (presentation.layers.length !== publicArtifacts.size) {
    throw notFound("Map presentation layers do not match public domain artifacts.");
  }
  for (const layer of presentation.layers) {
    const artifact = publicArtifacts.get(layer.artifact_id);
    if (
      !artifact ||
      JSON.stringify(layer.source_provenance) !== JSON.stringify(artifact.source_provenance)
    ) {
      throw notFound("Map presentation provenance does not match the domain artifact.");
    }
    validatePackProvenance(layer.source_provenance, registry, true);
  }
  const archivePath = resolvePackPath(presentationRoot, presentation.archive.path);
  const archiveStats = await stat(archivePath).catch((error: unknown) => {
    if (isMissingFile(error)) {
      throw notFound("Missing map presentation archive.");
    }
    throw error;
  });
  if (archiveStats.size !== presentation.archive.size_bytes) {
    throw notFound("Map presentation archive size does not match.");
  }
  const previouslyVerified = verifiedMapArchives.get(archivePath);
  if (
    !previouslyVerified ||
    previouslyVerified.size !== archiveStats.size ||
    previouslyVerified.modifiedAt !== archiveStats.mtimeMs ||
    previouslyVerified.sha256 !== presentation.archive.sha256
  ) {
    const archiveBytes = await readBytes(archivePath, "map presentation archive");
    if (sha256Hex(archiveBytes) !== presentation.archive.sha256) {
      throw notFound("Map presentation archive checksum does not match.");
    }
    verifiedMapArchives.set(archivePath, {
      size: archiveStats.size,
      modifiedAt: archiveStats.mtimeMs,
      sha256: presentation.archive.sha256,
    });
  }
  return { presentation, archivePath, manifest, packRoot };
}

function parseSingleRange(
  rangeHeader: string | undefined,
  totalSize: number,
): { start: number; end: number } {
  const match = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader ?? "");
  if (!match) {
    throw new ProviderDataError(
      "invalid_request",
      "Map presentation archive requires one valid bytes range.",
    );
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : totalSize - 1;
  const end = Math.min(requestedEnd, totalSize - 1);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= totalSize ||
    end < start
  ) {
    throw new ProviderDataError(
      "invalid_request",
      "Map presentation byte range is not satisfiable.",
    );
  }
  return { start, end };
}
