import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  type AdministrativeBoundaryRequest,
  type AdministrativeBoundaryResponse,
  administrativeBoundaryResponseSchema,
  type ProviderRuntimeJob,
  type ProviderRuntimePreflightResponse,
  providerRuntimePreflightResponseSchema,
  type ProviderRuntimeRequest,
  type ProviderRuntimeResponse,
  providerRuntimeResponseSchema,
} from "../types/provider.js";
import { ProviderDataError } from "./providerDataService.js";
import { runtimePythonExecutable } from "./runtimePython.js";

const execFileAsync = promisify(execFile);
const RUNTIME_WORKER_TIMEOUT_MS = 8 * 60 * 1000;
export const PUBLIC_DEMO_REFRESH_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const backendCwd =
  process.env.MDQ_BACKEND_DIR ?? fileURLToPath(new URL("../../../backend/", import.meta.url));
const runtimePython = runtimePythonExecutable(backendCwd);
export function createRuntimeRequestCoordinator(
  runner: (request: ProviderRuntimeRequest) => Promise<ProviderRuntimeResponse> = runRuntimeWorker,
) {
  const inProgress = new Map<string, Promise<ProviderRuntimeResponse>>();
  return {
    submit(request: ProviderRuntimeRequest): Promise<ProviderRuntimeResponse> {
      const key = canonicalJson(request);
      const existing = inProgress.get(key);
      if (existing) {
        return existing;
      }
      const job = runner(request).finally(() => inProgress.delete(key));
      inProgress.set(key, job);
      return job;
    },
  };
}

const defaultCoordinator = createRuntimeRequestCoordinator();
type RuntimeProgressUpdate = Pick<
  ProviderRuntimeJob,
  | "event"
  | "total_domains"
  | "completed_domains"
  | "active_domain"
  | "queried_feature_count"
  | "accepted_feature_count"
  | "derived_feature_count"
>;
type RuntimeJobRunner = (
  request: ProviderRuntimeRequest,
  report: (progress: RuntimeProgressUpdate) => void,
  options?: { skipPmtiles?: boolean },
) => Promise<ProviderRuntimeResponse>;

export function createRuntimeJobCoordinator(runner: RuntimeJobRunner = runRuntimeWorker) {
  const jobs = new Map<string, ProviderRuntimeJob>();
  const requestByJob = new Map<string, ProviderRuntimeRequest>();
  const inProgressByRequest = new Map<string, string>();
  return {
    submit(
      request: ProviderRuntimeRequest,
      options?: { reuseSucceededWithinMs?: number; now?: number; skipPmtiles?: boolean },
    ): ProviderRuntimeJob {
      const requestKey = canonicalJson(request);
      const cooldownMs = options?.reuseSucceededWithinMs ?? 0;
      if (cooldownMs > 0) {
        const now = options?.now ?? Date.now();
        const reusable = [...requestByJob.entries()]
          .filter(([, existingRequest]) => canonicalJson(existingRequest) === requestKey)
          .map(([jobId]) => jobs.get(jobId))
          .filter((job): job is ProviderRuntimeJob => job?.state === "succeeded")
          .filter((job) => {
            const completedAt = Date.parse(job.updated_at);
            return Number.isFinite(completedAt) && completedAt >= now - cooldownMs;
          })
          .sort((left, right) => Date.parse(right.updated_at) - Date.parse(left.updated_at))[0];
        if (reusable) {
          return reusable;
        }
      }
      const existingId = inProgressByRequest.get(requestKey);
      if (existingId) {
        const existing = jobs.get(existingId);
        if (existing) {
          return existing;
        }
      }
      const now = new Date().toISOString();
      const job: ProviderRuntimeJob = {
        job_id: randomUUID(),
        state: "queued",
        event: "queued",
        total_domains: new Set(request.profiles).size,
        completed_domains: 0,
        active_domain: null,
        queried_feature_count: 0,
        accepted_feature_count: 0,
        derived_feature_count: 0,
        started_at: now,
        updated_at: now,
      };
      jobs.set(job.job_id, job);
      requestByJob.set(job.job_id, request);
      inProgressByRequest.set(requestKey, job.job_id);
      void runner(
        request,
        (progress) => {
          const current = jobs.get(job.job_id);
          if (!current || current.state === "failed" || current.state === "succeeded") {
            return;
          }
          jobs.set(job.job_id, {
            ...current,
            state: "running",
            ...progress,
            updated_at: new Date().toISOString(),
          });
        },
        { skipPmtiles: options?.skipPmtiles },
      )
        .then((result) => {
          const current = jobs.get(job.job_id);
          if (current) {
            jobs.set(job.job_id, {
              ...current,
              state: "succeeded",
              event: "published",
              total_domains: result.outcomes.length,
              completed_domains: result.outcomes.length,
              active_domain: null,
              queried_feature_count: sumOutcomeCounts(result, "queried_feature_count"),
              accepted_feature_count: sumOutcomeCounts(result, "accepted_feature_count"),
              derived_feature_count: sumOutcomeCounts(result, "derived_feature_count"),
              result,
              updated_at: new Date().toISOString(),
            });
          }
        })
        .catch((error: unknown) => {
          const current = jobs.get(job.job_id);
          if (current) {
            jobs.set(job.job_id, {
              ...current,
              state: "failed",
              event: "failed",
              active_domain: null,
              error: workerFailureMessage(
                error,
                "AOI preparation failed before a new snapshot could be published.",
              ),
              updated_at: new Date().toISOString(),
            });
          }
        })
        .finally(() => inProgressByRequest.delete(requestKey));
      return job;
    },
    get(jobId: string): ProviderRuntimeJob | undefined {
      return jobs.get(jobId);
    },
    getForAoi(aoi: ProviderRuntimeRequest["aoi"]): ProviderRuntimeJob | undefined {
      const aoiKey = canonicalJson(aoi);
      for (const [jobId, request] of requestByJob) {
        if (canonicalJson(request.aoi) === aoiKey) {
          const job = jobs.get(jobId);
          if (job && (job.state === "queued" || job.state === "running")) {
            return job;
          }
        }
      }
      return undefined;
    },
  };
}

const defaultJobCoordinator = createRuntimeJobCoordinator();

export function submitRuntimeRequest(
  request: ProviderRuntimeRequest,
): Promise<ProviderRuntimeResponse> {
  return defaultCoordinator.submit(request);
}

export function submitRuntimeJob(request: ProviderRuntimeRequest): ProviderRuntimeJob {
  return defaultJobCoordinator.submit(request);
}

/** Public demo submissions may observe a completed fresh snapshot, but may not
 * create a second job during the fixed 24-hour public refresh interval. */
export function submitDemoRuntimeJob(request: ProviderRuntimeRequest): ProviderRuntimeJob {
  return defaultJobCoordinator.submit(request, {
    reuseSucceededWithinMs: PUBLIC_DEMO_REFRESH_COOLDOWN_MS,
  });
}

export function getRuntimeJob(jobId: string): ProviderRuntimeJob | undefined {
  return defaultJobCoordinator.get(jobId);
}

export function getRuntimeJobForAoi(
  aoi: ProviderRuntimeRequest["aoi"],
): ProviderRuntimeJob | undefined {
  return defaultJobCoordinator.getForAoi(aoi);
}

type CatalogFetcher = () => Promise<{ stdout: string }>;

const defaultCatalogFetcher: CatalogFetcher = () =>
  execFileAsync(
    runtimePython,
    [
      "-c",
      "from geo_pipeline.aoi_runtime import administrative_catalog; import json; print(json.dumps(administrative_catalog()))",
    ],
    { cwd: backendCwd },
  );

let cachedCatalogPromise: Promise<unknown> | null = null;

export async function getAdministrativeCatalog(
  fetcher: CatalogFetcher = defaultCatalogFetcher,
): Promise<unknown> {
  if (cachedCatalogPromise) {
    return cachedCatalogPromise;
  }
  cachedCatalogPromise = (async () => {
    try {
      const { stdout } = await fetcher();
      return JSON.parse(stdout) as unknown;
    } catch (error) {
      cachedCatalogPromise = null;
      if (error instanceof ProviderDataError) {
        throw error;
      }
      throw new ProviderDataError(
        "worker_failed",
        workerFailureMessage(error, "Administrative catalogue could not be read."),
      );
    }
  })();
  return cachedCatalogPromise;
}

export function resetAdministrativeCatalogCache(): void {
  cachedCatalogPromise = null;
}

export async function getAdministrativeBoundary(
  request: AdministrativeBoundaryRequest,
): Promise<AdministrativeBoundaryResponse> {
  return runAoiRuntimePython<AdministrativeBoundaryResponse>(
    "administrative_boundary",
    request.unit_ids,
    administrativeBoundaryResponseSchema,
  );
}

export async function preflightRuntimeRequest(
  request: ProviderRuntimeRequest,
): Promise<ProviderRuntimePreflightResponse> {
  return runAoiRuntimePython<ProviderRuntimePreflightResponse>(
    "preflight_runtime_request",
    request,
    providerRuntimePreflightResponseSchema,
  );
}

async function runAoiRuntimePython<T>(
  functionName: "administrative_boundary" | "preflight_runtime_request",
  argument: unknown,
  schema: { parse(value: unknown): T },
): Promise<T> {
  try {
    const code = `from geo_pipeline.aoi_runtime import ${functionName}, RuntimeRequestError; import json, sys\ntry:\n print(json.dumps({"status":"ok","result":${functionName}(json.loads(sys.argv[1]))}))\nexcept RuntimeRequestError as error:\n print(json.dumps({"status":"error","code":"invalid_request","message":str(error)}))`;
    const { stdout } = await execFileAsync(runtimePython, ["-c", code, JSON.stringify(argument)], {
      cwd: backendCwd,
      maxBuffer: 32 * 1024 * 1024,
      timeout: 120_000,
    });
    const payload = JSON.parse(stdout) as {
      status?: unknown;
      code?: unknown;
      message?: unknown;
      result?: unknown;
    };
    if (
      payload.status === "error" &&
      payload.code === "invalid_request" &&
      typeof payload.message === "string"
    ) {
      throw new ProviderDataError("invalid_request", payload.message);
    }
    if (payload.status !== "ok") {
      throw new Error("Administrative AOI worker returned an invalid envelope.");
    }
    return schema.parse(payload.result);
  } catch (error) {
    if (error instanceof ProviderDataError) {
      throw error;
    }
    throw new ProviderDataError(
      "worker_failed",
      workerFailureMessage(error, "Administrative AOI validation could not be completed."),
    );
  }
}

async function runRuntimeWorker(
  request: ProviderRuntimeRequest,
  report?: (progress: RuntimeProgressUpdate) => void,
  options?: { skipPmtiles?: boolean },
): Promise<ProviderRuntimeResponse> {
  return new Promise<ProviderRuntimeResponse>((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let pendingStderr = "";
    let timedOut = false;
    const workerArgs = [
      "-m",
      "geo_pipeline.worker",
      "--runtime-request",
      JSON.stringify(request),
      "--input",
      "live",
      "--progress-jsonl",
    ];
    if (options?.skipPmtiles) {
      workerArgs.push("--skip-pmtiles");
    }
    const worker = spawn(runtimePython, workerArgs, {
      cwd: backendCwd,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      worker.kill("SIGTERM");
    }, RUNTIME_WORKER_TIMEOUT_MS);

    const processStderrLine = (line: string) => {
      if (!line.startsWith("MDQ_PROGRESS:")) {
        stderr += line;
        return;
      }
      try {
        report?.(JSON.parse(line.slice("MDQ_PROGRESS:".length)) as RuntimeProgressUpdate);
      } catch {
        // Ignore malformed progress line
      }
    };

    worker.stdout.setEncoding("utf8");
    worker.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });

    worker.stderr.setEncoding("utf8");
    worker.stderr.on("data", (chunk: string) => {
      const combined = pendingStderr + chunk;
      const lines = combined.split("\n");
      pendingStderr = lines.pop() ?? "";
      lines.forEach((line) => processStderrLine(`${line}\n`));
    });

    worker.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    worker.on("close", (code) => {
      clearTimeout(timeout);
      if (pendingStderr) {
        processStderrLine(pendingStderr);
      }
      if (code !== 0) {
        reject(Object.assign(new Error(stderr || "Process failed"), { stderr, timedOut }));
        return;
      }
      try {
        resolve(providerRuntimeResponseSchema.parse(JSON.parse(stdout)));
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }).catch((error: unknown) => {
    throw new ProviderDataError(
      "worker_failed",
      workerFailureMessage(
        error,
        "AOI preparation failed before a new snapshot could be published.",
      ),
    );
  });
}

function sumOutcomeCounts(
  result: ProviderRuntimeResponse,
  key: "queried_feature_count" | "accepted_feature_count" | "derived_feature_count",
): number {
  return result.outcomes.reduce((total, outcome) => total + (outcome[key] ?? 0), 0);
}

export function workerFailureMessage(error: unknown, fallback: string): string {
  if (
    error &&
    typeof error === "object" &&
    "timedOut" in error &&
    (error as { timedOut?: unknown }).timedOut === true
  ) {
    return "worker_timeout: AOI preparation exceeded its eight-minute safety limit before publishing a snapshot.";
  }
  const stderr =
    error && typeof error === "object" && "stderr" in error
      ? (error as { stderr?: unknown }).stderr
      : undefined;
  const text =
    typeof stderr === "string"
      ? stderr.trim()
      : Buffer.isBuffer(stderr)
        ? stderr.toString("utf8").trim()
        : "";
  if (text) {
    try {
      const payload = JSON.parse(text) as { status?: unknown; code?: unknown; message?: unknown };
      if (
        payload.status === "error" &&
        typeof payload.code === "string" &&
        typeof payload.message === "string"
      ) {
        return `${payload.code}: ${payload.message}`;
      }
    } catch {
      // Do not expose unstructured subprocess output to the API.
    }
  }
  return fallback;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).sort().join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
