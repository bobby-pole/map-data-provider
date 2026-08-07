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
    throw new ProviderDataError("worker_failed", workerFailureMessage(error, "Administrative catalogue could not be read."));
  }
}

async function runRuntimeWorker(request: ProviderRuntimeRequest) {
  try {
    const { stdout } = await execFileAsync("uv", ["run", "--offline", "python", "-m", "geo_pipeline.worker", "--runtime-request", JSON.stringify(request), "--input", "live"], { cwd: new URL("../../../backend/", import.meta.url), maxBuffer: 1024 * 1024, timeout: 240_000 });
    return providerRuntimeResponseSchema.parse(JSON.parse(stdout));
  } catch (error) {
    throw new ProviderDataError(
      "worker_failed",
      workerFailureMessage(error, "AOI preparation failed before a new snapshot could be published."),
    );
  }
}

export function workerFailureMessage(error: unknown, fallback: string): string {
  const stderr = error && typeof error === "object" && "stderr" in error ? (error as { stderr?: unknown }).stderr : undefined;
  const text = typeof stderr === "string" ? stderr.trim() : Buffer.isBuffer(stderr) ? stderr.toString("utf8").trim() : "";
  if (text) {
    try {
      const payload = JSON.parse(text) as { status?: unknown; code?: unknown; message?: unknown };
      if (payload.status === "error" && typeof payload.code === "string" && typeof payload.message === "string") {
        return `${payload.code}: ${payload.message}`;
      }
    } catch {
      // Do not expose unstructured subprocess output to the API.
    }
  }
  return fallback;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).sort().join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
