import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  cachedMetadataSchema,
  providerIdentifierSchema,
  providerLayerResponseSchema,
  readinessRecordSchema,
  sourceRegistrySchema,
  type CachedMetadata,
  type ProviderLayerResponse,
  type ReadinessRecord,
  type SourceRegistry,
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
  return sourceRegistrySchema.parse(registry);
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
