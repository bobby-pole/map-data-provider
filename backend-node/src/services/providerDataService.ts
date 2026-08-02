import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { z } from "zod";

import {
  providerIdentifierSchema,
  providerLayerResponseSchema,
  readinessRecordSchema,
  sourceRegistrySchema,
  sourceRegistryV2Schema,
  domainPackV2Schema,
  cachedMetadataSchema,
  domainPackReadResponseSchema,
  isPublicExportEligible,
  validateOrderedSourceProvenance,
  type CachedMetadata,
  type DomainPackReadResponse,
  type ProviderLayerResponse,
  type ReadinessRecord,
  type SourceRegistry,
  type SourceRegistryV2,
} from "../types/provider.js";

const projectRoot = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const defaultCacheRoot = path.join(projectRoot, "backend", "data", "cache");
const defaultRegistryPath = path.join(projectRoot, "backend", "data", "sources", "registry.json");
const packDirectoryName = "domain-pack-v2";

export type ProviderDataPaths = {
  cacheRoot?: string;
  registryPath?: string;
};

export class ProviderDataError extends Error {
  constructor(
    readonly kind: "invalid_request" | "not_found" | "conflict" | "worker_failed",
    message: string,
  ) {
    super(message);
  }
}

export async function getCachedLayers(aoiId: string, dataPaths?: ProviderDataPaths): Promise<CachedMetadata[]> {
  validateIdentifier(aoiId, "AOI");
  const aoiRoot = path.join(cacheRootFor(dataPaths), aoiId);
  const domains = await readCacheDomains(aoiRoot, aoiId);
  if (domains.length === 0) {
    throw notFound(`No cached layers exist for AOI '${aoiId}'.`);
  }
  return Promise.all(domains.map((domain) => getCachedMetadata(aoiId, domain, dataPaths)));
}

export async function getCachedLayer(aoiId: string, domain: string, dataPaths?: ProviderDataPaths): Promise<ProviderLayerResponse> {
  validateIdentifier(aoiId, "AOI");
  validateIdentifier(domain, "domain");
  const layer = await readJson(path.join(cacheRootFor(dataPaths), aoiId, domain, "layer.geojson"), `cached layer '${aoiId}/${domain}'`);
  return providerLayerResponseSchema.parse(layer);
}

export async function getCachedReadiness(aoiId: string, dataPaths?: ProviderDataPaths): Promise<ReadinessRecord[]> {
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

export async function getSourcesForAoi(aoiId: string, dataPaths?: ProviderDataPaths): Promise<SourceRegistry> {
  await getCachedLayers(aoiId, dataPaths);
  const registry = await readJson(registryPathFor(dataPaths), "source registry");
  return toV1SourceRegistry(sourceRegistryV2Schema.parse(registry));
}

export async function getDomainPacks(aoiId: string, dataPaths?: ProviderDataPaths): Promise<DomainPackReadResponse[]> {
  validateIdentifier(aoiId, "AOI");
  const aoiRoot = path.join(cacheRootFor(dataPaths), aoiId);
  let entries;
  try {
    entries = await readdir(aoiRoot, { withFileTypes: true });
  } catch (error) {
    if (isMissingFile(error)) throw notFound(`No cached domain packs exist for AOI '${aoiId}'.`);
    throw error;
  }
  const domains = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((domain) => providerIdentifierSchema.safeParse(domain).success)
    .sort();
  const packs = await Promise.all(domains.map((domain) => getDomainPack(aoiId, domain, dataPaths).catch((error: unknown) => {
    if (error instanceof ProviderDataError && error.kind === "not_found" && error.message.startsWith("Missing domain-pack manifest")) return null;
    throw error;
  })));
  const registered = packs.filter((pack): pack is DomainPackReadResponse => pack !== null);
  if (registered.length === 0) throw notFound(`No cached domain packs exist for AOI '${aoiId}'.`);
  return registered;
}

export async function getDomainPack(aoiId: string, domain: string, dataPaths?: ProviderDataPaths): Promise<DomainPackReadResponse> {
  validateIdentifier(aoiId, "AOI");
  validateIdentifier(domain, "domain");
  const packRoot = path.join(cacheRootFor(dataPaths), aoiId, domain, packDirectoryName);
  const manifest = domainPackV2Schema.parse(await readJson(path.join(packRoot, "manifest.json"), `domain-pack manifest '${aoiId}/${domain}'`));
  if (manifest.aoi_id !== aoiId || manifest.domain !== domain) {
    throw new ProviderDataError("not_found", "Domain-pack identity does not match the request.");
  }
  assertSafePackPaths(packRoot, manifest);
  const registry = sourceRegistryV2Schema.parse(await readJson(registryPathFor(dataPaths), "source registry"));
  validatePackProvenance(manifest.source_provenance, registry, false);
  const validation = cachedMetadataSchema.parse(await readJson(resolvePackPath(packRoot, manifest.validation.path), "domain-pack validation record"));
  const readiness = readinessRecordSchema.parse(await readJson(resolvePackPath(packRoot, manifest.readiness.path), "domain-pack readiness record"));
  if (validation.aoi_id !== aoiId || validation.domain !== domain || readiness.aoi_id !== aoiId || readiness.domain !== domain) {
    throw new ProviderDataError("not_found", "Domain-pack validation or readiness identity does not match the request.");
  }

  const layers = [];
  const sourceIds = new Set<string>();
  for (const artifact of manifest.artifacts) {
    if (!isAnalyticalGeoJsonArtifact(artifact)) continue;
    validatePackProvenance(artifact.source_provenance, registry, true);
    const layerBytes = await readBytes(resolvePackPath(packRoot, artifact.path), `domain-pack artifact '${artifact.id}'`);
    if (digest(layerBytes) !== artifact.sha256) {
      throw new ProviderDataError("not_found", `Domain-pack artifact '${artifact.id}' checksum does not match.`);
    }
    const layer = providerLayerResponseSchema.parse(JSON.parse(layerBytes.toString("utf8")) as unknown);
    if (layer.metadata.aoi_id !== aoiId || layer.metadata.domain !== domain || layer.metadata.layer_id !== artifact.id) {
      throw new ProviderDataError("not_found", `Domain-pack artifact '${artifact.id}' identity does not match its manifest.`);
    }
    if (artifact.feature_count !== undefined && layer.features.length !== artifact.feature_count) {
      throw new ProviderDataError("not_found", `Domain-pack artifact '${artifact.id}' feature count does not match its manifest.`);
    }
    artifact.source_provenance.forEach((record) => sourceIds.add(record.source_id));
    layers.push({ artifact, layer });
  }
  const sources = [...sourceIds]
    .sort()
    .map((sourceId) => {
      const source = registry.sources.find((candidate) => candidate.id === sourceId);
      if (!source || !isPublicExportEligible(source)) {
        throw new ProviderDataError("not_found", `Domain-pack source '${sourceId}' is not eligible for public analytical delivery.`);
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

function toV1SourceRegistry(registry: SourceRegistryV2): SourceRegistry {
  const legacySourceIds = ["openstreetmap", "manual_power_seed", "kiut_gesut_wms"];
  const sources = legacySourceIds.map((sourceId) => {
    const source = registry.sources.find((candidate) => candidate.id === sourceId);
    if (!source) throw new Error(`source_registry/v2 is missing v1 compatibility source '${sourceId}'.`);
    const sourceType = source.usage_role === "analytical"
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

async function getCachedMetadata(aoiId: string, domain: string, dataPaths?: ProviderDataPaths): Promise<CachedMetadata> {
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
    if (isMissingFile(error)) throw notFound(`Missing ${label}.`);
    throw error;
  }
}

function isAnalyticalGeoJsonArtifact(artifact: z.infer<typeof domainPackV2Schema>["artifacts"][number]): artifact is z.infer<typeof domainPackV2Schema>["artifacts"][number] & {
  kind: "processed_vector" | "derived_vector" | "representative_points";
  format: "geojson";
  path: string;
  sha256: string;
  public_export: true;
} {
  return artifact.public_export === true
    && artifact.format === "geojson"
    && typeof artifact.path === "string"
    && typeof artifact.sha256 === "string"
    && (artifact.kind === "processed_vector" || artifact.kind === "derived_vector" || artifact.kind === "representative_points");
}

function assertSafePackPaths(packRoot: string, manifest: z.infer<typeof domainPackV2Schema>): void {
  resolvePackPath(packRoot, manifest.validation.path);
  resolvePackPath(packRoot, manifest.readiness.path);
  for (const artifact of manifest.artifacts) {
    if (artifact.path) resolvePackPath(packRoot, artifact.path);
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
      error instanceof Error ? `Invalid domain-pack provenance: ${error.message}` : "Invalid domain-pack provenance.",
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
    throw new ProviderDataError("invalid_request", `${label} must use lowercase letters, digits and underscores only.`);
  }
}

function notFound(message: string): ProviderDataError {
  return new ProviderDataError("not_found", message);
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
