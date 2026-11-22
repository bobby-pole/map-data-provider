import { readdir } from "node:fs/promises";
import path from "node:path";

import {
  type CachedMetadata,
  cachedMetadataSchema,
  type DomainPackReadResponse,
  domainPackReadResponseSchema,
  domainPackV2Schema,
  isPublicExportEligible,
  providerIdentifierSchema,
  type ProviderLayerResponse,
  providerLayerResponseSchema,
  type ReadinessRecord,
  readinessRecordSchema,
  sourceRegistryV2Schema,
} from "../types/provider.js";
import { sha256Hex } from "../utils/canonicalJson.js";
import {
  assertDataLicenseNoticeFiles,
  assertSafePackPaths,
  cacheRootFor,
  isAnalyticalGeoJsonArtifact,
  isMissingFile,
  notFound,
  packDirectoryName,
  ProviderDataError,
  type ProviderDataPaths,
  readBytes,
  readJson,
  registryPathFor,
  resolvePackPath,
  validateIdentifier,
  validatePackProvenance,
} from "./providerPaths.js";

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
  await assertDataLicenseNoticeFiles(packRoot, manifest);
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
    if (sha256Hex(layerBytes) !== artifact.sha256) {
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
