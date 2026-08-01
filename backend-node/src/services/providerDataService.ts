import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  cachedMetadataSchema,
  providerIdentifierSchema,
  providerLayerResponseSchema,
  readinessRecordSchema,
  sourceRegistrySchema,
  sourceRegistryV2Schema,
  type CachedMetadata,
  type ProviderLayerResponse,
  type ReadinessRecord,
  type SourceRegistry,
  type SourceRegistryV2,
} from "../types/provider.js";

const projectRoot = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const cacheRoot = path.join(projectRoot, "backend", "data", "cache");
const registryPath = path.join(projectRoot, "backend", "data", "sources", "registry.json");

export class ProviderDataError extends Error {
  constructor(
    readonly kind: "invalid_request" | "not_found" | "conflict" | "worker_failed",
    message: string,
  ) {
    super(message);
  }
}

export async function getCachedLayers(aoiId: string): Promise<CachedMetadata[]> {
  validateIdentifier(aoiId, "AOI");
  const aoiRoot = path.join(cacheRoot, aoiId);
  const domains = await readCacheDomains(aoiRoot, aoiId);
  if (domains.length === 0) {
    throw notFound(`No cached layers exist for AOI '${aoiId}'.`);
  }
  return Promise.all(domains.map((domain) => getCachedMetadata(aoiId, domain)));
}

export async function getCachedLayer(aoiId: string, domain: string): Promise<ProviderLayerResponse> {
  validateIdentifier(aoiId, "AOI");
  validateIdentifier(domain, "domain");
  const layer = await readJson(path.join(cacheRoot, aoiId, domain, "layer.geojson"), `cached layer '${aoiId}/${domain}'`);
  return providerLayerResponseSchema.parse(layer);
}

export async function getCachedReadiness(aoiId: string): Promise<ReadinessRecord[]> {
  const layers = await getCachedLayers(aoiId);
  return Promise.all(
    layers.map(async (layer) => {
      const readiness = await readJson(
        path.join(cacheRoot, aoiId, layer.domain, "readiness.json"),
        `readiness record '${aoiId}/${layer.domain}'`,
      );
      return readinessRecordSchema.parse(readiness);
    }),
  );
}

export async function getSourcesForAoi(aoiId: string): Promise<SourceRegistry> {
  await getCachedLayers(aoiId);
  const registry = await readJson(registryPath, "source registry");
  return toV1SourceRegistry(sourceRegistryV2Schema.parse(registry));
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
      usable_for_simulation: source.usable_for_simulation,
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

async function getCachedMetadata(aoiId: string, domain: string): Promise<CachedMetadata> {
  const metadata = await readJson(
    path.join(cacheRoot, aoiId, domain, "metadata.json"),
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
