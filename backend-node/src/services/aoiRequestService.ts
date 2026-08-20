import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { ProviderDataError, getCachedLayers } from "./providerDataService.js";
import type { CachedMetadata } from "../types/provider.js";

const execFileAsync = promisify(execFile);
export const CACHE_FRESHNESS_MS = 24 * 60 * 60 * 1000;

const RYBNIK_AOI = {
  id: "rybnik_35km" as const,
  boundary_reference: "Rybnik centre point with 35 km radius",
  crs: "EPSG:4326" as const,
  allowed_domains: ["power"] as const,
};

type Dependencies = {
  readCachedLayers: (aoiId: string) => Promise<CachedMetadata[]>;
  runWorker: (aoiId: string, domain: string) => Promise<void>;
  now: () => Date;
};

export async function requestAoi(
  aoiId: string,
  domain: string,
  dependencies: Partial<Dependencies> = {},
) {
  if (aoiId !== RYBNIK_AOI.id) {
    throw new ProviderDataError("invalid_request", `Unknown AOI '${aoiId}'.`);
  }
  if (domain !== "power") {
    throw new ProviderDataError("invalid_request", `Domain '${domain}' is not supported for '${aoiId}'.`);
  }
  const deps: Dependencies = {
    readCachedLayers: getCachedLayers,
    runWorker: defaultWorkerRunner,
    now: () => new Date(),
    ...dependencies,
  };
  let metadata = await readDomain(deps.readCachedLayers, aoiId, domain);
  if (metadata && isFresh(metadata, deps.now())) {
    return { aoi: RYBNIK_AOI, domain, cache_status: "fresh" as const, result: "cache" as const, metadata };
  }
  try {
    await deps.runWorker(aoiId, domain);
  } catch (error) {
    throw new ProviderDataError("worker_failed", error instanceof Error ? error.message : "Worker execution failed.");
  }
  metadata = await readDomain(deps.readCachedLayers, aoiId, domain);
  if (!metadata) {
    throw new ProviderDataError("worker_failed", "Worker completed without producing cache metadata.");
  }
  return { aoi: RYBNIK_AOI, domain, cache_status: "refreshed" as const, result: "refresh" as const, metadata };
}

export function isFresh(metadata: CachedMetadata, now: Date): boolean {
  return now.getTime() - new Date(metadata.snapshot_at).getTime() <= CACHE_FRESHNESS_MS;
}

async function readDomain(readCachedLayers: Dependencies["readCachedLayers"], aoiId: string, domain: string) {
  try {
    return (await readCachedLayers(aoiId)).find((entry) => entry.domain === domain);
  } catch (error) {
    if (error instanceof ProviderDataError && error.kind === "not_found") return undefined;
    throw error;
  }
}

async function defaultWorkerRunner(aoiId: string, domain: string): Promise<void> {
  await execFileAsync("uv", ["run", "--offline", "python", "-m", "geo_pipeline.worker", "--aoi", aoiId, "--domain", domain, "--input", "fixture"], {
    cwd: new URL("../../../backend/", import.meta.url),
  });
}
