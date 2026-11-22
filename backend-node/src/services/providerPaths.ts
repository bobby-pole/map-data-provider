import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { z } from "zod";

import {
  type domainPackV2Schema,
  providerIdentifierSchema,
  type SourceRegistryV2,
  validateOrderedSourceProvenance,
} from "../types/provider.js";

export const projectRoot = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
export const defaultCacheRoot =
  process.env.MDQ_PREPARED_ROOT ??
  process.env.MDQ_CACHE_ROOT ??
  path.join(projectRoot, "backend", "data", "cache");
export const defaultRegistryPath =
  process.env.MDQ_REGISTRY_PATH ??
  path.join(projectRoot, "backend", "data", "sources", "registry.json");
export const defaultSourceAvailabilityRoot =
  process.env.MDQ_SOURCE_AVAILABILITY_ROOT ??
  path.join(projectRoot, "backend", "data", "source-availability");
export const packDirectoryName = "domain-pack-v2";

export type ProviderDataPaths = {
  cacheRoot?: string;
  registryPath?: string;
  sourceAvailabilityRoot?: string;
};

export class ProviderDataError extends Error {
  constructor(
    readonly kind:
      | "invalid_request"
      | "not_found"
      | "conflict"
      | "worker_failed"
      | "runtime_disabled"
      | "demo_aoi_restricted"
      | "runtime_unauthorized",
    message: string,
  ) {
    super(message);
  }
}

export function cacheRootFor(dataPaths?: ProviderDataPaths): string {
  return dataPaths?.cacheRoot ?? defaultCacheRoot;
}

export function registryPathFor(dataPaths?: ProviderDataPaths): string {
  return dataPaths?.registryPath ?? defaultRegistryPath;
}

export function validateIdentifier(value: string, label: string): void {
  if (!providerIdentifierSchema.safeParse(value).success) {
    throw new ProviderDataError(
      "invalid_request",
      `${label} must use lowercase letters, digits and underscores only.`,
    );
  }
}

export function notFound(message: string): ProviderDataError {
  return new ProviderDataError("not_found", message);
}

export function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

export async function readJson(filePath: string, label: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (isMissingFile(error)) {
      throw notFound(`Missing ${label}.`);
    }
    throw error;
  }
}

export async function readBytes(filePath: string, label: string): Promise<Buffer> {
  try {
    return await readFile(filePath);
  } catch (error) {
    if (isMissingFile(error)) {
      throw notFound(`Missing ${label}.`);
    }
    throw error;
  }
}

export function resolvePackPath(packRoot: string, relativePath: string): string {
  const root = path.resolve(packRoot);
  const candidate = path.resolve(root, relativePath);
  if (!relativePath || candidate === root || !candidate.startsWith(`${root}${path.sep}`)) {
    throw new ProviderDataError("not_found", "Domain-pack path escapes its root.");
  }
  return candidate;
}

export function isAnalyticalGeoJsonArtifact(
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

export function assertSafePackPaths(
  packRoot: string,
  manifest: z.infer<typeof domainPackV2Schema>,
): void {
  resolvePackPath(packRoot, manifest.validation.path);
  resolvePackPath(packRoot, manifest.readiness.path);
  for (const notice of manifest.data_license_notices ?? []) {
    resolvePackPath(packRoot, notice.notice_path);
  }
  for (const artifact of manifest.artifacts) {
    if (artifact.path) {
      resolvePackPath(packRoot, artifact.path);
    }
  }
}

export async function assertDataLicenseNoticeFiles(
  packRoot: string,
  manifest: z.infer<typeof domainPackV2Schema>,
): Promise<void> {
  for (const notice of manifest.data_license_notices ?? []) {
    const payload = await readBytes(
      resolvePackPath(packRoot, notice.notice_path),
      `data licence notice '${notice.source_id}'`,
    );
    const content = payload.toString("utf8");
    if (!content.includes(notice.license_url) || !content.includes(notice.attribution_url)) {
      throw new ProviderDataError(
        "not_found",
        `Data licence notice '${notice.source_id}' does not retain its required links.`,
      );
    }
  }
}

export function validatePackProvenance(
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
