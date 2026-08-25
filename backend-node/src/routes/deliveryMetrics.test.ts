import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import { deliveryMetricsResponseSchema, providerErrorSchema } from "../types/provider.js";

const temporaryDirectories: string[] = [];

describe("delivery measurement routes", () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it("serves a report only when it matches the active bundle manifest", async () => {
    const { app } = await fixtureApp();

    const summary = await request(app).get("/api/metrics/delivery");
    expect(summary.status).toBe(200);
    expect(deliveryMetricsResponseSchema.parse(summary.body)).toMatchObject({
      bundle_id: "rybnik-35km-test",
      raw_report_url: "/api/metrics/delivery/raw",
      pmtiles: { revalidation_cache: { hit_ratio: 0.95 } },
    });
    expect(summary.body.api[0].observations).toBeUndefined();
    expect(summary.body.fixture_worker.aoi_request).toBeUndefined();

    const raw = await request(app).get("/api/metrics/delivery/raw");
    expect(raw.status).toBe(200);
    expect(raw.headers["cache-control"]).toBe("no-cache");
    expect(raw.body).toMatchObject({
      measurement_version: "mdq_demo_delivery_measurement/v1",
      bundle_id: "rybnik-35km-test",
      api: [expect.objectContaining({ id: "health" })],
    });
  });

  it("does not expose a report for a different bundle manifest", async () => {
    const { app } = await fixtureApp({ reportManifestSha256: "a".repeat(64) });

    const response = await request(app).get("/api/metrics/delivery");
    expect(response.status).toBe(404);
    expect(providerErrorSchema.parse(response.body)).toMatchObject({ error: "not_found" });
  });
});

async function fixtureApp(options?: { reportManifestSha256?: string }) {
  const root = await mkdtemp(path.join(os.tmpdir(), "mdq-delivery-metrics-"));
  temporaryDirectories.push(root);
  const preparedRoot = path.join(root, "prepared");
  const reportRoot = path.join(root, "reports");
  await mkdir(path.join(preparedRoot, "rybnik_35km"), { recursive: true });
  await mkdir(reportRoot, { recursive: true });
  const manifestBytes = Buffer.from(
    `${JSON.stringify({
      demo_bundle_version: "mdq_demo_bundle/v1",
      bundle_id: "rybnik-35km-test",
      aoi_id: "rybnik_35km",
    })}\n`,
  );
  await writeFile(
    path.join(preparedRoot, "rybnik_35km", "demo_bundle_manifest.json"),
    manifestBytes,
  );
  const manifestSha256 = createHash("sha256").update(manifestBytes).digest("hex");
  const report = {
    measurement_version: "mdq_demo_delivery_measurement/v1",
    measured_at: "2026-08-25T10:00:00.000Z",
    git_revision: "0123456789abcdef",
    bundle_id: "rybnik-35km-test",
    bundle_manifest_sha256: options?.reportManifestSha256 ?? manifestSha256,
    methodology: {
      samples_per_endpoint: 100,
      percentile: "nearest-rank percentile over sequential requests",
      service_mode: "operator-provisioned read-only demo bundle",
      caveat: "Local delivery measurement.",
    },
    environment: {
      base_url: "http://127.0.0.1:3001",
      aoi_id: "rybnik_35km",
      node: "v22.0.0",
      platform: "darwin/arm64",
      cpu_model: "test CPU",
    },
    api: [
      {
        id: "health",
        method: "GET",
        path: "/api/health",
        sample_count: 100,
        latency_ms: { min: 1, p50: 1, p95: 2, p99: 3, max: 4, mean: 2 },
        response_bytes: { min: 40, mean: 42, max: 45, total: 4_200 },
      },
    ],
    pmtiles: {
      path: "/api/aoi/rybnik_35km/presentations/power/archive",
      range: "bytes=0-16383",
      range_requests: { response_bytes: { mean: 1_024, total: 102_400 } },
      revalidation_cache: {
        hits: 95,
        misses: 5,
        hit_ratio: 0.95,
        hit_definition: "HTTP 304 response to a request carrying the archive ETag.",
      },
    },
    delivered_inventory: { domains: 11, public_layers: 27, processed_feature_count: 52_976 },
    fixture_worker: {
      measurement_version: "mdq_fixture_worker_measurement/v1",
      fixture_mode: true,
      aoi_request: { aoi: { type: "point_radius" }, profiles: ["power"] },
      fixture_preparation: { duration_ms: 120, domains: 11, processed_feature_count: 52_976 },
      worker: { successes: 11, failures: 0, success_rate: 1 },
      runtime_cache: { samples: 100, hits: 100, misses: 0, hit_ratio: 1 },
      runtime_outcomes: { ready: 11, needs_source: 0, failed: 0 },
    },
  };
  await writeFile(
    path.join(reportRoot, "2026-08-25-rybnik_35km-local.json"),
    `${JSON.stringify(report)}\n`,
  );
  return {
    app: createApp({ deliveryMetricsPaths: { measurementsRoot: reportRoot, preparedRoot } }),
  };
}
