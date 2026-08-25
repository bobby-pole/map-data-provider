#!/usr/bin/env node

/**
 * Reproducible delivery measurement for a running immutable Rybnik demo.
 *
 * It makes no changes to the demo service.  Fixture worker preparation is
 * isolated by backend/scripts/measure_demo_worker.py in a temporary directory.
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const defaultBaseUrl = "http://127.0.0.1:3001";
const aoiId = process.env.MDQ_MEASURE_AOI_ID ?? "rybnik_35km";
const baseUrl = (process.env.MDQ_MEASURE_BASE_URL ?? defaultBaseUrl).replace(/\/$/, "");
const samples = parsePositiveInteger(
  process.env.MDQ_MEASURE_SAMPLES ?? "100",
  "MDQ_MEASURE_SAMPLES",
);
const reportDirectory = path.resolve(
  projectRoot,
  process.env.MDQ_MEASURE_REPORT_DIR ?? "docs/measurements",
);
const bundleManifestPath = path.resolve(
  projectRoot,
  process.env.MDQ_MEASURE_BUNDLE_MANIFEST ??
    path.join(
      process.env.MDQ_LOCAL_BUNDLE_ROOT ?? ".local-demo-bundle",
      aoiId,
      "demo_bundle_manifest.json",
    ),
);

const endpoints = [
  { id: "health", path: "/api/health", expectedStatus: 200 },
  { id: "layer-list", path: `/api/aoi/${aoiId}/layers`, expectedStatus: 200 },
  { id: "presentation-list", path: `/api/aoi/${aoiId}/presentations`, expectedStatus: 200 },
  { id: "readiness", path: `/api/aoi/${aoiId}/readiness`, expectedStatus: 200 },
  { id: "power-domain-pack", path: `/api/aoi/${aoiId}/domain-packs/power`, expectedStatus: 200 },
  {
    id: "nine-domain-export",
    path: `/api/aoi/${aoiId}/export?domains=power,emergency,public,transport,bridges,water,gas,sewer,industrial`,
    expectedStatus: 200,
  },
];
let rateLimitRetries = 0;

function parsePositiveInteger(value, name) {
  if (!/^\d+$/.test(value) || Number(value) < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return Number(value);
}

function percentile(samples, value) {
  const ordered = [...samples].sort((left, right) => left - right);
  const index = Math.max(
    0,
    Math.min(ordered.length - 1, Math.ceil((value / 100) * ordered.length) - 1),
  );
  return ordered[index];
}

function summarize(samples) {
  const durations = samples.map((sample) => sample.duration_ms);
  const bytes = samples.map((sample) => sample.response_bytes);
  const statuses = Object.fromEntries(
    [
      ...samples.reduce(
        (counts, sample) => counts.set(sample.status, (counts.get(sample.status) ?? 0) + 1),
        new Map(),
      ),
    ].sort(([left], [right]) => Number(left) - Number(right)),
  );
  return {
    sample_count: samples.length,
    latency_ms: {
      min: Math.min(...durations),
      p50: percentile(durations, 50),
      p95: percentile(durations, 95),
      p99: percentile(durations, 99),
      max: Math.max(...durations),
      mean: round(durations.reduce((total, duration) => total + duration, 0) / durations.length),
    },
    response_bytes: {
      min: Math.min(...bytes),
      max: Math.max(...bytes),
      mean: round(bytes.reduce((total, size) => total + size, 0) / bytes.length),
      total: bytes.reduce((total, size) => total + size, 0),
    },
    statuses,
  };
}

function round(value) {
  return Number(value.toFixed(3));
}

async function request(pathname, headers = {}, parseJson = false) {
  const startedAt = process.hrtime.bigint();
  const response = await fetch(`${baseUrl}${pathname}`, { headers });
  const body = new Uint8Array(await response.arrayBuffer());
  return {
    duration_ms: round(Number(process.hrtime.bigint() - startedAt) / 1_000_000),
    status: response.status,
    response_bytes: body.byteLength,
    etag: response.headers.get("etag"),
    content_range: response.headers.get("content-range"),
    retry_after_seconds: parseRetryAfter(response.headers.get("retry-after")),
    json: parseJson ? JSON.parse(new TextDecoder().decode(body)) : undefined,
  };
}

async function requestMeasured(pathname, headers = {}, parseJson = false) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const observation = await request(pathname, headers, parseJson);
    if (observation.status !== 429) {
      return observation;
    }
    rateLimitRetries += 1;
    const retryAfterSeconds = observation.retry_after_seconds ?? 60;
    console.log(
      `API rate limit reached; waiting ${retryAfterSeconds}s before retrying ${pathname}.`,
    );
    await delay(retryAfterSeconds * 1_000);
  }
  throw new Error(`API kept returning HTTP 429 for ${pathname} after five retry attempts.`);
}

function parseRetryAfter(header) {
  if (!header) {
    return undefined;
  }
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : undefined;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function measureEndpoint(endpoint) {
  const observations = [];
  for (let index = 0; index < samples; index += 1) {
    const observation = await requestMeasured(endpoint.path);
    if (observation.status !== endpoint.expectedStatus) {
      throw new Error(
        `${endpoint.id} request ${index + 1}/${samples} returned HTTP ${observation.status}; expected ${endpoint.expectedStatus}.`,
      );
    }
    observations.push(observation);
  }
  return {
    id: endpoint.id,
    method: "GET",
    path: endpoint.path,
    ...summarize(observations),
    observations,
  };
}

async function measurePmtiles() {
  const archivePath = `/api/aoi/${aoiId}/presentations/power/archive`;
  const range = "bytes=0-16383";
  const rangeObservations = [];
  for (let index = 0; index < samples; index += 1) {
    const observation = await requestMeasured(archivePath, { range });
    if (observation.status !== 206) {
      throw new Error(
        `PMTiles range request ${index + 1}/${samples} returned HTTP ${observation.status}; expected 206.`,
      );
    }
    rangeObservations.push(observation);
  }
  const etag = rangeObservations[0].etag;
  if (!etag) {
    throw new Error(
      "PMTiles archive response did not provide an ETag for revalidation measurement.",
    );
  }

  const revalidations = [];
  for (let index = 0; index < samples; index += 1) {
    const observation = await requestMeasured(archivePath, { range, "if-none-match": etag });
    if (![304, 206].includes(observation.status)) {
      throw new Error(
        `PMTiles revalidation ${index + 1}/${samples} returned HTTP ${observation.status}; expected 304 or 206.`,
      );
    }
    revalidations.push(observation);
  }
  const hits = revalidations.filter((observation) => observation.status === 304).length;
  return {
    path: archivePath,
    range,
    etag,
    range_requests: { ...summarize(rangeObservations), observations: rangeObservations },
    revalidation_requests: { ...summarize(revalidations), observations: revalidations },
    revalidation_cache: {
      hits,
      misses: revalidations.length - hits,
      hit_ratio: round(hits / revalidations.length),
      hit_definition: "HTTP 304 response to a request carrying the archive ETag.",
    },
  };
}

async function getDomainInventory() {
  const response = await requestMeasured(`/api/aoi/${aoiId}/domain-packs`, {}, true);
  if (response.status !== 200) {
    throw new Error(`Domain inventory returned HTTP ${response.status}.`);
  }
  const payload = response.json;
  const readiness = { ready: 0, needs_source: 0, failed: 0 };
  let processedFeatureCount = 0;
  for (const pack of payload.domain_packs) {
    for (const layer of pack.layers) {
      processedFeatureCount += layer.layer.metadata.feature_count;
      if (layer.layer.metadata.readiness === "ready") {
        readiness.ready += 1;
      } else if (layer.layer.metadata.readiness === "needs_source") {
        readiness.needs_source += 1;
      }
    }
  }
  return {
    domains: payload.domain_packs.length,
    public_layers: payload.domain_packs.reduce((total, pack) => total + pack.layers.length, 0),
    processed_feature_count: processedFeatureCount,
    validation_outcomes: readiness,
  };
}

async function measureWorker() {
  const { stdout } = await execFileAsync(
    "uv",
    ["run", "python", "scripts/measure_demo_worker.py", "--cache-samples", String(samples)],
    { cwd: path.join(projectRoot, "backend"), maxBuffer: 10 * 1024 * 1024 },
  );
  return JSON.parse(stdout);
}

async function gitRevision() {
  try {
    const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: projectRoot });
    return stdout.trim();
  } catch {
    return null;
  }
}

async function bundleIdentity() {
  let bytes;
  try {
    bytes = await readFile(bundleManifestPath);
  } catch (error) {
    throw new Error(
      `Cannot read bundle manifest at ${bundleManifestPath}. Set MDQ_MEASURE_BUNDLE_MANIFEST to the exact bundle served by the API. ${error.message}`,
    );
  }
  let manifest;
  try {
    manifest = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`Bundle manifest at ${bundleManifestPath} is not valid JSON.`);
  }
  if (manifest.aoi_id !== aoiId || typeof manifest.bundle_id !== "string" || !manifest.bundle_id) {
    throw new Error(`Bundle manifest at ${bundleManifestPath} does not identify ${aoiId}.`);
  }
  return {
    bundle_id: manifest.bundle_id,
    bundle_manifest_sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

async function main() {
  try {
    await request("/api/health");
  } catch (error) {
    throw new Error(
      `Cannot reach the local demo at ${baseUrl}. Start it in another terminal with 'pnpm run demo:local'. ${error.message}`,
    );
  }

  console.log(`Measuring ${samples} requests for each published endpoint at ${baseUrl}…`);
  const bundle = await bundleIdentity();
  // Keep measurements serial. Concurrent worker preparation would otherwise
  // distort the API latency distribution that this report is meant to expose.
  const api = [];
  for (const endpoint of endpoints) {
    console.log(`Measuring API ${endpoint.id} (${samples} requests)…`);
    api.push(await measureEndpoint(endpoint));
  }
  console.log(`Measuring PMTiles range delivery (${samples} requests plus revalidation)…`);
  const pmtiles = await measurePmtiles();
  console.log("Reading delivered domain inventory…");
  const inventory = await getDomainInventory();
  console.log("Measuring isolated fixture-worker preparation and warm cache…");
  const worker = await measureWorker();
  const measuredAt = new Date().toISOString();
  const report = {
    measurement_version: "mdq_demo_delivery_measurement/v1",
    measured_at: measuredAt,
    git_revision: await gitRevision(),
    ...bundle,
    methodology: {
      percentile: "nearest-rank percentile over sequential requests",
      samples_per_endpoint: samples,
      rate_limit_retries: rateLimitRetries,
      service_mode: "operator-provisioned read-only demo bundle",
      caveat:
        "Results are local delivery measurements, not an internet or browser-rendering benchmark.",
    },
    environment: {
      base_url: baseUrl,
      aoi_id: aoiId,
      node: process.version,
      platform: `${process.platform}/${process.arch}`,
      cpu_model: os.cpus()[0]?.model ?? "unknown",
    },
    api,
    pmtiles,
    delivered_inventory: inventory,
    fixture_worker: worker,
  };
  await mkdir(reportDirectory, { recursive: true });
  const date = measuredAt.slice(0, 10);
  const reportPath = path.join(reportDirectory, `${date}-${aoiId}-local.json`);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Measurement report written to ${path.relative(projectRoot, reportPath)}`);
}

main().catch((error) => {
  console.error(`Measurement failed: ${error.message}`);
  process.exitCode = 1;
});
