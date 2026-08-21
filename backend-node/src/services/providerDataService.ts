import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { open, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import type { z } from "zod";

import {
  type CachedMetadata,
  cachedMetadataSchema,
  type DomainPackReadResponse,
  domainPackReadResponseSchema,
  domainPackV2Schema,
  isPublicExportEligible,
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
  type ProviderLayerResponse,
  providerLayerResponseSchema,
  type ReadinessRecord,
  readinessRecordSchema,
  sourceAvailabilityReportSchema,
  type SourceRegistry,
  sourceRegistrySchema,
  type SourceRegistryV2,
  sourceRegistryV2Schema,
  validateOrderedSourceProvenance,
} from "../types/provider.js";

const projectRoot = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const defaultCacheRoot = path.join(projectRoot, "backend", "data", "cache");
const defaultRegistryPath = path.join(projectRoot, "backend", "data", "sources", "registry.json");
const packDirectoryName = "domain-pack-v2";
const verifiedMapArchives = new Map<string, { size: number; modifiedAt: number; sha256: string }>();
const execFileAsync = promisify(execFile);
const circuitRecoveryByFeature = new Map<string, Promise<void>>();

export type ProviderDataPaths = {
  cacheRoot?: string;
  registryPath?: string;
  sourceAvailabilityRoot?: string;
};

export type MapPresentationArchiveRange = {
  bytes: Buffer;
  totalSize: number;
  start: number;
  end: number;
  etag: string;
};

export class ProviderDataError extends Error {
  constructor(
    readonly kind: "invalid_request" | "not_found" | "conflict" | "worker_failed",
    message: string,
  ) {
    super(message);
  }
}

export async function getCachedLayers(
  aoiId: string,
  dataPaths?: ProviderDataPaths,
): Promise<CachedMetadata[]> {
  validateIdentifier(aoiId, "AOI");
  const aoiRoot = path.join(cacheRootFor(dataPaths), aoiId);
  const domains = await readCacheDomains(aoiRoot, aoiId);
  if (domains.length === 0) {
    throw notFound(`No cached layers exist for AOI '${aoiId}'.`);
  }
  return Promise.all(domains.map((domain) => getCachedMetadata(aoiId, domain, dataPaths)));
}

export async function getCachedLayer(
  aoiId: string,
  domain: string,
  dataPaths?: ProviderDataPaths,
): Promise<ProviderLayerResponse> {
  validateIdentifier(aoiId, "AOI");
  validateIdentifier(domain, "domain");
  const layer = await readJson(
    path.join(cacheRootFor(dataPaths), aoiId, domain, "layer.geojson"),
    `cached layer '${aoiId}/${domain}'`,
  );
  return providerLayerResponseSchema.parse(layer);
}

export async function getCachedReadiness(
  aoiId: string,
  dataPaths?: ProviderDataPaths,
): Promise<ReadinessRecord[]> {
  const layers = await getCachedLayers(aoiId, dataPaths);
  return Promise.all(
    layers.map(async (layer) => {
      const readiness = await readJson(
        path.join(cacheRootFor(dataPaths), aoiId, layer.domain, "readiness.json"),
        `readiness record '${aoiId}/${layer.domain}'`,
      );
      return readinessRecordSchema.parse(readiness);
    }),
  );
}

export async function getSourcesForAoi(
  aoiId: string,
  dataPaths?: ProviderDataPaths,
): Promise<SourceRegistry> {
  await getCachedLayers(aoiId, dataPaths);
  const registry = await readJson(registryPathFor(dataPaths), "source registry");
  return toV1SourceRegistry(sourceRegistryV2Schema.parse(registry));
}

function buildDefaultSourceAvailabilityReport(aoiId: string) {
  const now = new Date().toISOString();
  return {
    report_version: "provider_source_availability/v1" as const,
    aoi_id: aoiId,
    evidence_timestamp: now,
    sources: [
      {
        source_id: "openstreetmap",
        availability: "available" as const,
        aoi_coverage: "covered" as const,
        feature_state: "available" as const,
        evidence_timestamp: now,
        fresh_after_days: 7,
        evidence: "Live Overpass OSM acquisition for requested AOI boundary",
        freshness: "fresh" as const,
        eligibility: "allowed" as const,
        actionable_gap: false,
      },
      {
        source_id: "manual_power_seed",
        availability: "not_eligible" as const,
        aoi_coverage: "not_applicable" as const,
        feature_state: "not_applicable" as const,
        evidence_timestamp: now,
        fresh_after_days: 30,
        evidence: "Local review fixture input (demo fixture only)",
        freshness: "fresh" as const,
        eligibility: "rejected" as const,
        actionable_gap: true,
      },
      {
        source_id: "prg_wfs",
        availability: "available" as const,
        aoi_coverage: "covered" as const,
        feature_state: "available" as const,
        evidence_timestamp: now,
        fresh_after_days: 7,
        evidence: "Official PRG national administrative boundary and representative points",
        freshness: "fresh" as const,
        eligibility: "allowed" as const,
        actionable_gap: false,
      },
      {
        source_id: "bdot10k",
        availability: "available" as const,
        aoi_coverage: "uncovered" as const,
        feature_state: "not_applicable" as const,
        evidence_timestamp: now,
        fresh_after_days: 7,
        evidence:
          "Custom AOI outside pre-packaged BDOT10k county bundles; official vector extraction pending",
        freshness: "fresh" as const,
        eligibility: "allowed" as const,
        actionable_gap: true,
      },
      {
        source_id: "kiut_gesut_wms",
        availability: "reference_only" as const,
        aoi_coverage: "covered" as const,
        feature_state: "not_applicable" as const,
        evidence_timestamp: now,
        fresh_after_days: 1,
        evidence: "National GUGiK KIUT/GESUT WMS reference capability",
        freshness: "fresh" as const,
        eligibility: "rejected" as const,
        actionable_gap: false,
      },
      {
        source_id: "geoportal_orthophoto",
        availability: "reference_only" as const,
        aoi_coverage: "covered" as const,
        feature_state: "not_applicable" as const,
        evidence_timestamp: now,
        fresh_after_days: 7,
        evidence: "National high-resolution Geoportal orthophoto WMS reference capability",
        freshness: "fresh" as const,
        eligibility: "rejected" as const,
        actionable_gap: false,
      },
      {
        source_id: "nmt_nmpt",
        availability: "available" as const,
        aoi_coverage: "covered" as const,
        feature_state: "available" as const,
        evidence_timestamp: now,
        fresh_after_days: 30,
        evidence: "NMT/NMPT digital terrain elevation model capability",
        freshness: "fresh" as const,
        eligibility: "allowed" as const,
        actionable_gap: false,
      },
    ],
  };
}

export async function getSourceAvailability(aoiId: string, dataPaths?: ProviderDataPaths) {
  validateIdentifier(aoiId, "AOI");
  const root =
    dataPaths?.sourceAvailabilityRoot ??
    path.join(projectRoot, "backend", "data", "source-availability");
  const primaryPath = path.join(root, `${aoiId}.json`);
  const cachePath = path.join(cacheRootFor(dataPaths), aoiId, "source_availability.json");

  let rawReport: unknown;
  try {
    rawReport = await readJson(primaryPath, `source availability '${aoiId}'`);
  } catch (primaryError) {
    if (primaryError instanceof ProviderDataError && primaryError.kind === "not_found") {
      try {
        rawReport = await readJson(cachePath, `cached source availability '${aoiId}'`);
      } catch (cacheError) {
        if (cacheError instanceof ProviderDataError && cacheError.kind === "not_found") {
          rawReport = buildDefaultSourceAvailabilityReport(aoiId);
        } else {
          throw cacheError;
        }
      }
    } else {
      throw primaryError;
    }
  }

  const report = sourceAvailabilityReportSchema.parse(rawReport);
  if (report.aoi_id !== aoiId) {
    throw new ProviderDataError(
      "not_found",
      "Source availability identity does not match the request.",
    );
  }
  return report;
}

export async function getDomainPacks(
  aoiId: string,
  dataPaths?: ProviderDataPaths,
): Promise<DomainPackReadResponse[]> {
  validateIdentifier(aoiId, "AOI");
  const aoiRoot = path.join(cacheRootFor(dataPaths), aoiId);
  let entries;
  try {
    entries = await readdir(aoiRoot, { withFileTypes: true });
  } catch (error) {
    if (isMissingFile(error)) {
      throw notFound(`No cached domain packs exist for AOI '${aoiId}'.`);
    }
    throw error;
  }
  const domains = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((domain) => providerIdentifierSchema.safeParse(domain).success)
    .sort();
  const packs = await Promise.all(
    domains.map((domain) =>
      getDomainPack(aoiId, domain, dataPaths).catch((error: unknown) => {
        if (
          error instanceof ProviderDataError &&
          error.kind === "not_found" &&
          error.message.startsWith("Missing domain-pack manifest")
        ) {
          return null;
        }
        throw error;
      }),
    ),
  );
  const registered = packs.filter((pack): pack is DomainPackReadResponse => pack !== null);
  if (registered.length === 0) {
    throw notFound(`No cached domain packs exist for AOI '${aoiId}'.`);
  }
  return registered;
}

export async function getDomainPack(
  aoiId: string,
  domain: string,
  dataPaths?: ProviderDataPaths,
): Promise<DomainPackReadResponse> {
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
    throw new ProviderDataError("not_found", "Domain-pack identity does not match the request.");
  }
  assertSafePackPaths(packRoot, manifest);
  const registry = sourceRegistryV2Schema.parse(
    await readJson(registryPathFor(dataPaths), "source registry"),
  );
  validatePackProvenance(manifest.source_provenance, registry, false);
  const validation = cachedMetadataSchema.parse(
    await readJson(
      resolvePackPath(packRoot, manifest.validation.path),
      "domain-pack validation record",
    ),
  );
  const readiness = readinessRecordSchema.parse(
    await readJson(
      resolvePackPath(packRoot, manifest.readiness.path),
      "domain-pack readiness record",
    ),
  );
  if (
    validation.aoi_id !== aoiId ||
    validation.domain !== domain ||
    readiness.aoi_id !== aoiId ||
    readiness.domain !== domain
  ) {
    throw new ProviderDataError(
      "not_found",
      "Domain-pack validation or readiness identity does not match the request.",
    );
  }

  const layers = [];
  const sourceIds = new Set<string>();
  for (const artifact of manifest.artifacts) {
    if (!isAnalyticalGeoJsonArtifact(artifact)) {
      continue;
    }
    validatePackProvenance(artifact.source_provenance, registry, true);
    const layerBytes = await readBytes(
      resolvePackPath(packRoot, artifact.path),
      `domain-pack artifact '${artifact.id}'`,
    );
    if (digest(layerBytes) !== artifact.sha256) {
      throw new ProviderDataError(
        "not_found",
        `Domain-pack artifact '${artifact.id}' checksum does not match.`,
      );
    }
    const layer = providerLayerResponseSchema.parse(
      JSON.parse(layerBytes.toString("utf8")) as unknown,
    );
    if (
      layer.metadata.aoi_id !== aoiId ||
      layer.metadata.domain !== domain ||
      layer.metadata.layer_id !== artifact.id
    ) {
      throw new ProviderDataError(
        "not_found",
        `Domain-pack artifact '${artifact.id}' identity does not match its manifest.`,
      );
    }
    if (artifact.feature_count !== undefined && layer.features.length !== artifact.feature_count) {
      throw new ProviderDataError(
        "not_found",
        `Domain-pack artifact '${artifact.id}' feature count does not match its manifest.`,
      );
    }
    artifact.source_provenance.forEach((record) => sourceIds.add(record.source_id));
    layers.push({ artifact, layer });
  }
  const sources = [...sourceIds].sort().map((sourceId) => {
    const source = registry.sources.find((candidate) => candidate.id === sourceId);
    if (!source || !isPublicExportEligible(source)) {
      throw new ProviderDataError(
        "not_found",
        `Domain-pack source '${sourceId}' is not eligible for public analytical delivery.`,
      );
    }
    return source;
  });
  return domainPackReadResponseSchema.parse({
    response_version: "provider_domain_pack_read/v2",
    aoi_id: aoiId,
    domain,
    source_provenance: manifest.source_provenance,
    validation,
    readiness,
    layers,
    sources,
  });
}

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
): Promise<MapPresentationArchiveRange> {
  const { presentation, archivePath } = await validatedMapPresentation(aoiId, domain, dataPaths);
  const totalSize = presentation.archive.size_bytes;
  const range = parseSingleRange(rangeHeader, totalSize);
  const handle = await open(archivePath, "r");
  try {
    const bytes = Buffer.alloc(range.end - range.start + 1);
    await handle.read(bytes, 0, bytes.length, range.start);
    return { ...range, bytes, totalSize, etag: `"${presentation.archive.sha256}"` };
  } finally {
    await handle.close();
  }
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
  if (digest(bytes) !== artifact.sha256) {
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
  const recovery = (async () => {
    const aoi = await runtimeAoiForId(aoiId);
    const script = [
      "from pathlib import Path",
      "import json, sys",
      "from geo_pipeline.runtime_osm import backfill_power_circuit_evidence_for_member",
      "result = backfill_power_circuit_evidence_for_member(aoi=json.loads(sys.argv[1]), source_id=sys.argv[2], root=Path(sys.argv[3]))",
      "print(json.dumps({'availability': result.get('availability', 'available')}))",
    ].join("\n");
    await execFileAsync(
      "uv",
      ["run", "--offline", "python", "-c", script, JSON.stringify(aoi), sourceId, defaultCacheRoot],
      {
        cwd: path.join(projectRoot, "backend"),
        timeout: 90_000,
        maxBuffer: 4 * 1024 * 1024,
      },
    );
  })().finally(() => circuitRecoveryByFeature.delete(key));
  circuitRecoveryByFeature.set(key, recovery);
  return recovery;
}

async function runtimeAoiForId(aoiId: string): Promise<unknown> {
  const stateRoot = path.join(projectRoot, "backend", "cache", "provider-runtime-v1");
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

function toV1SourceRegistry(registry: SourceRegistryV2): SourceRegistry {
  const legacySourceIds = ["openstreetmap", "manual_power_seed", "kiut_gesut_wms"];
  const sources = legacySourceIds.map((sourceId) => {
    const source = registry.sources.find((candidate) => candidate.id === sourceId);
    if (!source) {
      throw new Error(`source_registry/v2 is missing v1 compatibility source '${sourceId}'.`);
    }
    const sourceType =
      source.usage_role === "analytical"
        ? "analytical_vector"
        : source.usage_role === "review"
          ? "manual_seed"
          : "reference_overlay";
    return {
      id: source.id,
      name: source.name,
      source_type: sourceType,
      role: `${source.usage_role} ${source.data_kind} source.`,
      access: source.access_method,
      not_authoritative: source.not_authoritative,
      eligible_for_analysis: source.eligible_for_analysis,
      source_url: source.source_url,
      attribution: source.attribution,
      license: source.license,
      license_url: source.license_url,
      distribution_guidance: `${source.distribution.public_export}: ${source.distribution.reason}`,
      availability_caveats: source.availability_caveats,
      limitations: source.limitations,
      ...(source.cache_provenance ? { analytical_cache_provenance: source.cache_provenance } : {}),
      ...(source.format === "wms" ? { service_type: "OGC WMS" } : {}),
    };
  });
  return sourceRegistrySchema.parse({ registry_version: "source_registry/v1", sources });
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
  if (presentation.parent_domain_pack.sha256 !== digest(Buffer.from(canonicalJson(manifest)))) {
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
    if (digest(archiveBytes) !== presentation.archive.sha256) {
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

async function getCachedMetadata(
  aoiId: string,
  domain: string,
  dataPaths?: ProviderDataPaths,
): Promise<CachedMetadata> {
  const metadata = await readJson(
    path.join(cacheRootFor(dataPaths), aoiId, domain, "metadata.json"),
    `cache metadata '${aoiId}/${domain}'`,
  );
  return cachedMetadataSchema.parse(metadata);
}

async function readCacheDomains(aoiRoot: string, aoiId: string): Promise<string[]> {
  try {
    const entries = await readdir(aoiRoot, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch (error) {
    if (isMissingFile(error)) {
      throw notFound(`No cached layers exist for AOI '${aoiId}'.`);
    }
    throw error;
  }
}

async function readJson(filePath: string, label: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (isMissingFile(error)) {
      throw notFound(`Missing ${label}.`);
    }
    throw error;
  }
}

async function readBytes(filePath: string, label: string): Promise<Buffer> {
  try {
    return await readFile(filePath);
  } catch (error) {
    if (isMissingFile(error)) {
      throw notFound(`Missing ${label}.`);
    }
    throw error;
  }
}

function isAnalyticalGeoJsonArtifact(
  artifact: z.infer<typeof domainPackV2Schema>["artifacts"][number],
): artifact is z.infer<typeof domainPackV2Schema>["artifacts"][number] & {
  kind: "processed_vector" | "derived_vector" | "representative_points";
  format: "geojson";
  path: string;
  sha256: string;
  public_export: true;
} {
  return (
    artifact.public_export === true &&
    artifact.format === "geojson" &&
    typeof artifact.path === "string" &&
    typeof artifact.sha256 === "string" &&
    (artifact.kind === "processed_vector" ||
      artifact.kind === "derived_vector" ||
      artifact.kind === "representative_points")
  );
}

function assertSafePackPaths(packRoot: string, manifest: z.infer<typeof domainPackV2Schema>): void {
  resolvePackPath(packRoot, manifest.validation.path);
  resolvePackPath(packRoot, manifest.readiness.path);
  for (const artifact of manifest.artifacts) {
    if (artifact.path) {
      resolvePackPath(packRoot, artifact.path);
    }
  }
}

function resolvePackPath(packRoot: string, relativePath: string): string {
  const root = path.resolve(packRoot);
  const candidate = path.resolve(root, relativePath);
  if (!relativePath || candidate === root || !candidate.startsWith(`${root}${path.sep}`)) {
    throw new ProviderDataError("not_found", "Domain-pack path escapes its root.");
  }
  return candidate;
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

function digest(payload: Buffer): string {
  return createHash("sha256").update(payload).digest("hex");
}

function validatePackProvenance(
  provenance: z.infer<typeof domainPackV2Schema>["source_provenance"],
  registry: SourceRegistryV2,
  publicExport: boolean,
): void {
  try {
    validateOrderedSourceProvenance(provenance, registry, publicExport);
  } catch (error) {
    throw new ProviderDataError(
      "not_found",
      error instanceof Error
        ? `Invalid domain-pack provenance: ${error.message}`
        : "Invalid domain-pack provenance.",
    );
  }
}

function cacheRootFor(dataPaths?: ProviderDataPaths): string {
  return dataPaths?.cacheRoot ?? defaultCacheRoot;
}

function registryPathFor(dataPaths?: ProviderDataPaths): string {
  return dataPaths?.registryPath ?? defaultRegistryPath;
}

function validateIdentifier(value: string, label: string): void {
  if (!providerIdentifierSchema.safeParse(value).success) {
    throw new ProviderDataError(
      "invalid_request",
      `${label} must use lowercase letters, digits and underscores only.`,
    );
  }
}

function notFound(message: string): ProviderDataError {
  return new ProviderDataError("not_found", message);
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
