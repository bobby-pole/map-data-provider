import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { z } from "zod";

import {
  deliveryMeasurementReportSchema,
  deliveryMetricsResponseSchema,
} from "../types/provider.js";

const projectRoot = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const defaultMeasurementsRoot =
  process.env.MDQ_MEASUREMENTS_ROOT ?? path.join(projectRoot, "docs", "measurements");
const defaultPreparedRoot =
  process.env.MDQ_PREPARED_ROOT ??
  process.env.MDQ_CACHE_ROOT ??
  path.join(projectRoot, "backend", "data", "cache");

export type DeliveryMetricsPaths = {
  measurementsRoot?: string;
  preparedRoot?: string;
};

type DeliveryMeasurementReport = z.infer<typeof deliveryMeasurementReportSchema>;

export class DeliveryMetricsError extends Error {
  constructor(
    readonly kind: "not_found" | "invalid_report",
    message: string,
  ) {
    super(message);
  }
}

export async function getDeliveryMetrics(paths?: DeliveryMetricsPaths) {
  const report = await getMatchingReport(paths);
  return deliveryMetricsResponseSchema.parse({
    measurement_version: report.parsed.measurement_version,
    measured_at: report.parsed.measured_at,
    git_revision: report.parsed.git_revision,
    bundle_id: report.parsed.bundle_id,
    methodology: report.parsed.methodology,
    environment: report.parsed.environment,
    api: report.parsed.api.map((entry) => ({
      id: entry.id,
      method: entry.method,
      path: entry.path,
      sample_count: entry.sample_count,
      latency_ms: {
        p50: entry.latency_ms.p50,
        p95: entry.latency_ms.p95,
        p99: entry.latency_ms.p99,
      },
      response_bytes: {
        mean: entry.response_bytes.mean,
        total: entry.response_bytes.total,
      },
    })),
    pmtiles: {
      path: report.parsed.pmtiles.path,
      range: report.parsed.pmtiles.range,
      range_requests: {
        response_bytes: {
          mean: report.parsed.pmtiles.range_requests.response_bytes.mean,
          total: report.parsed.pmtiles.range_requests.response_bytes.total,
        },
      },
      revalidation_cache: report.parsed.pmtiles.revalidation_cache,
    },
    delivered_inventory: {
      domains: report.parsed.delivered_inventory.domains,
      public_layers: report.parsed.delivered_inventory.public_layers,
      processed_feature_count: report.parsed.delivered_inventory.processed_feature_count,
    },
    fixture_worker: {
      fixture_mode: report.parsed.fixture_worker.fixture_mode,
      fixture_preparation: {
        duration_ms: report.parsed.fixture_worker.fixture_preparation.duration_ms,
        domains: report.parsed.fixture_worker.fixture_preparation.domains,
        processed_feature_count: report.parsed.fixture_worker.fixture_preparation.processed_feature_count,
      },
      worker: report.parsed.fixture_worker.worker,
      runtime_cache: {
        samples: report.parsed.fixture_worker.runtime_cache.samples,
        hits: report.parsed.fixture_worker.runtime_cache.hits,
        misses: report.parsed.fixture_worker.runtime_cache.misses,
        hit_ratio: report.parsed.fixture_worker.runtime_cache.hit_ratio,
      },
      runtime_outcomes: report.parsed.fixture_worker.runtime_outcomes,
    },
    response_version: "provider_delivery_metrics/v1",
    raw_report_url: "/api/metrics/delivery/raw",
  });
}

export async function getDeliveryMetricsRaw(paths?: DeliveryMetricsPaths): Promise<unknown> {
  return (await getMatchingReport(paths)).raw;
}

async function getMatchingReport(paths?: DeliveryMetricsPaths): Promise<{
  parsed: DeliveryMeasurementReport;
  raw: unknown;
}> {
  const preparedManifest = await getPreparedManifestIdentity(paths);
  const reportsRoot = paths?.measurementsRoot ?? defaultMeasurementsRoot;
  let entries: string[];
  try {
    entries = await readdir(reportsRoot);
  } catch (error) {
    if (isMissingPath(error)) {
      throw new DeliveryMetricsError("not_found", "No delivery measurement reports are published.");
    }
    throw error;
  }

  const reportNames = entries
    .filter((entry) => entry.endsWith(".json"))
    .sort((left, right) => right.localeCompare(left));
  for (const reportName of reportNames) {
    const reportPath = path.join(reportsRoot, reportName);
    let raw: unknown;
    try {
      raw = JSON.parse(await readFile(reportPath, "utf8"));
    } catch {
      continue;
    }
    const parsed = deliveryMeasurementReportSchema.safeParse(raw);
    if (!parsed.success) {
      continue;
    }
    if (
      parsed.data.bundle_id === preparedManifest.bundleId &&
      parsed.data.bundle_manifest_sha256 === preparedManifest.sha256
    ) {
      return { parsed: parsed.data, raw };
    }
  }
  throw new DeliveryMetricsError(
    "not_found",
    "No published delivery measurement report matches the active verified demo bundle.",
  );
}

async function getPreparedManifestIdentity(paths?: DeliveryMetricsPaths) {
  const preparedRoot = paths?.preparedRoot ?? defaultPreparedRoot;
  const manifestPath = path.join(preparedRoot, "rybnik_35km", "demo_bundle_manifest.json");
  let manifestBytes: Buffer;
  try {
    manifestBytes = await readFile(manifestPath);
  } catch (error) {
    if (isMissingPath(error)) {
      throw new DeliveryMetricsError(
        "not_found",
        "The active demo bundle manifest is unavailable.",
      );
    }
    throw error;
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    throw new DeliveryMetricsError(
      "invalid_report",
      "The active demo bundle manifest is malformed.",
    );
  }
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    !("bundle_id" in manifest) ||
    typeof manifest.bundle_id !== "string" ||
    manifest.bundle_id.length === 0
  ) {
    throw new DeliveryMetricsError(
      "invalid_report",
      "The active demo bundle has no valid bundle ID.",
    );
  }
  return {
    bundleId: manifest.bundle_id,
    sha256: createHash("sha256").update(manifestBytes).digest("hex"),
  };
}

function isMissingPath(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
