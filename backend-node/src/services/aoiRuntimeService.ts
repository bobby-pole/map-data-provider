import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { ProviderDataError } from "./providerDataService.js";
import { type ProviderRuntimeRequest, type ProviderRuntimeResponse, providerRuntimeResponseSchema } from "../types/provider.js";

const execFileAsync = promisify(execFile);
export function createRuntimeRequestCoordinator(
  runner: (request: ProviderRuntimeRequest) => Promise<ProviderRuntimeResponse> = runRuntimeWorker,
) {
  const inProgress = new Map<string, Promise<ProviderRuntimeResponse>>();
  return {
    submit(request: ProviderRuntimeRequest): Promise<ProviderRuntimeResponse> {
      const key = canonicalJson(request);
      const existing = inProgress.get(key);
      if (existing) return existing;
      const job = runner(request).finally(() => inProgress.delete(key));
      inProgress.set(key, job);
      return job;
    },
  };
}

const defaultCoordinator = createRuntimeRequestCoordinator();

export function submitRuntimeRequest(request: ProviderRuntimeRequest): Promise<ProviderRuntimeResponse> {
  return defaultCoordinator.submit(request);
}

export async function getAdministrativeCatalog(): Promise<unknown> {
  try {
    const { stdout } = await execFileAsync("uv", ["run", "--offline", "python", "-c", "from geo_pipeline.aoi_runtime import administrative_catalog; import json; print(json.dumps(administrative_catalog()))"], { cwd: new URL("../../../backend/", import.meta.url) });
    return JSON.parse(stdout);
  } catch (error) {
    throw new ProviderDataError("worker_failed", error instanceof Error ? error.message : "Administrative catalogue worker failed.");
  }
}

async function runRuntimeWorker(request: ProviderRuntimeRequest) {
  try {
    const { stdout } = await execFileAsync("uv", ["run", "--offline", "python", "-m", "geo_pipeline.worker", "--runtime-request", JSON.stringify(request), "--input", "live"], { cwd: new URL("../../../backend/", import.meta.url), maxBuffer: 1024 * 1024, timeout: 240_000 });
    return providerRuntimeResponseSchema.parse(JSON.parse(stdout));
  } catch (error) {
    throw new ProviderDataError("worker_failed", error instanceof Error ? error.message : "AOI runtime worker failed.");
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).sort().join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
