import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import { DEMO_AOI_TEMPLATE } from "../services/runtimeAcquisitionPolicy.js";
import { providerErrorSchema, type ProviderRuntimeRequest } from "../types/provider.js";
import { seedCompactRybnikCache } from "./testFixtures.js";

describe("runtime acquisition policy", () => {
  let fixtureCacheDir: string;
  let disabledApp: ReturnType<typeof createApp>;
  let demoApp: ReturnType<typeof createApp>;
  let localApp: ReturnType<typeof createApp>;
  let trustedApp: ReturnType<typeof createApp>;

  beforeAll(async () => {
    fixtureCacheDir = await mkdtemp(path.join(os.tmpdir(), "mdq-readonly-cache-"));
    await seedCompactRybnikCache(fixtureCacheDir);
    disabledApp = createApp({
      runtimePolicy: { mode: "disabled" },
      providerDataPaths: { cacheRoot: fixtureCacheDir },
    });
    demoApp = createApp({
      runtimePolicy: { mode: "demo_fixed_aoi" },
      providerDataPaths: { cacheRoot: fixtureCacheDir },
      demoRuntimeJobSubmitter: (request: ProviderRuntimeRequest) => ({
        job_id: "0d0ce687-3834-4d9f-933e-20f5778ff441",
        state: "queued",
        event: "queued",
        total_domains: new Set(request.profiles).size,
        completed_domains: 0,
        active_domain: null,
        queried_feature_count: 0,
        accepted_feature_count: 0,
        derived_feature_count: 0,
        started_at: "2026-08-29T10:00:00.000Z",
        updated_at: "2026-08-29T10:00:00.000Z",
      }),
    });
    const queuedJob = () => ({
      job_id: "f7b93d9e-b620-413c-82cd-ccb7a9e7f963",
      state: "queued" as const,
      event: "queued" as const,
      total_domains: 1,
      completed_domains: 0,
      active_domain: null,
      queried_feature_count: 0,
      accepted_feature_count: 0,
      derived_feature_count: 0,
      started_at: "2026-08-29T10:00:00.000Z",
      updated_at: "2026-08-29T10:00:00.000Z",
    });
    localApp = createApp({
      runtimePolicy: { mode: "local_bounded" },
      providerDataPaths: { cacheRoot: fixtureCacheDir },
      runtimeJobSubmitter: queuedJob,
    });
    trustedApp = createApp({
      runtimePolicy: { mode: "trusted", trustedToken: "fixture-service-token" },
      providerDataPaths: { cacheRoot: fixtureCacheDir },
      runtimeJobSubmitter: queuedJob,
    });
  });

  afterAll(async () => {
    await rm(fixtureCacheDir, { recursive: true, force: true });
  });

  it("rejects POST /api/aoi/requests with runtime_disabled", async () => {
    const response = await request(disabledApp)
      .post("/api/aoi/requests")
      .send({ aoi_id: "rybnik_35km", domain: "power" });

    expect(response.status).toBe(403);
    const parsed = providerErrorSchema.parse(response.body);
    expect(parsed.error).toBe("runtime_disabled");
    expect(parsed.message).toContain("disabled in this deployment");
  });

  it("rejects POST /api/aoi/runtime-requests with runtime_disabled", async () => {
    const response = await request(disabledApp)
      .post("/api/aoi/runtime-requests")
      .send({
        aoi: {
          type: "point_radius",
          longitude: 18.546285,
          latitude: 50.102174,
          radius_m: 5000,
        },
        profiles: ["power"],
      });

    expect(response.status).toBe(403);
    const parsed = providerErrorSchema.parse(response.body);
    expect(parsed.error).toBe("runtime_disabled");
    expect(parsed.message).toContain("disabled in this deployment");
  });

  it("rejects POST /api/aoi/runtime-jobs with runtime_disabled", async () => {
    const response = await request(disabledApp)
      .post("/api/aoi/runtime-jobs")
      .send({
        aoi: {
          type: "point_radius",
          longitude: 18.546285,
          latitude: 50.102174,
          radius_m: 5000,
        },
        profiles: ["power"],
      });

    expect(response.status).toBe(403);
    const parsed = providerErrorSchema.parse(response.body);
    expect(parsed.error).toBe("runtime_disabled");
    expect(parsed.message).toContain("disabled in this deployment");
  });

  it("reports and enforces bounded public demo acquisition", async () => {
    const capability = await request(demoApp).get("/api/aoi/runtime-capabilities");
    expect(capability.status).toBe(200);
    expect(capability.body).toMatchObject({
      mode: "demo_fixed_aoi",
      supports_custom_aoi: true,
      demo_template: {
        id: DEMO_AOI_TEMPLATE.id,
        max_radius_m: 10000,
        max_counties: 1,
        generates_pmtiles: true,
        profiles: DEMO_AOI_TEMPLATE.profiles,
      },
    });

    const selectedSubset = await request(demoApp)
      .post(`/api/aoi/demo-acquisitions/${DEMO_AOI_TEMPLATE.id}`)
      .send({
        aoi: { type: "point_radius", longitude: 18.546285, latitude: 50.102174, radius_m: 5000 },
        profiles: ["power"],
      });
    expect(selectedSubset.status).toBe(202);
    expect(selectedSubset.body).toMatchObject({ state: "queued", total_domains: 1 });

    const overLimit = await request(demoApp)
      .post(`/api/aoi/demo-acquisitions/${DEMO_AOI_TEMPLATE.id}`)
      .send({
        aoi: { type: "point_radius", longitude: 18.546285, latitude: 50.102174, radius_m: 15000 },
        profiles: DEMO_AOI_TEMPLATE.profiles,
      });
    expect(overLimit.status).toBe(403);
    expect(providerErrorSchema.parse(overLimit.body).error).toBe("demo_aoi_restricted");

    const demoJob = await request(demoApp)
      .post(`/api/aoi/demo-acquisitions/${DEMO_AOI_TEMPLATE.id}`)
      .send({
        aoi: { type: "point_radius", longitude: 18.546285, latitude: 50.102174, radius_m: 5000 },
        profiles: DEMO_AOI_TEMPLATE.profiles,
      });
    expect(demoJob.status).toBe(202);
    expect(demoJob.body).toMatchObject({ state: "queued", total_domains: 11 });

    const forceRefresh = await request(demoApp)
      .post(`/api/aoi/demo-acquisitions/${DEMO_AOI_TEMPLATE.id}`)
      .send({
        aoi: { type: "point_radius", longitude: 18.546285, latitude: 50.102174, radius_m: 5000 },
        profiles: DEMO_AOI_TEMPLATE.profiles,
        force_refresh: true,
      });
    expect(forceRefresh.status).toBe(403);
    expect(providerErrorSchema.parse(forceRefresh.body).error).toBe("demo_aoi_restricted");

    const genericForceRefresh = await request(demoApp)
      .post("/api/aoi/runtime-jobs")
      .send({ force_refresh: true });
    expect(genericForceRefresh.status).toBe(403);
    expect(providerErrorSchema.parse(genericForceRefresh.body).error).toBe("demo_aoi_restricted");
  });

  it("permits bounded local jobs and requires a trusted service token remotely", async () => {
    const runtimeRequest = {
      aoi: { type: "point_radius", longitude: 18.546285, latitude: 50.102174, radius_m: 5000 },
      profiles: ["power"],
    };
    const local = await request(localApp).post("/api/aoi/runtime-jobs").send(runtimeRequest);
    expect(local.status).toBe(202);

    const localOverLimit = await request(localApp)
      .post("/api/aoi/runtime-jobs")
      .send({
        ...runtimeRequest,
        aoi: { ...runtimeRequest.aoi, radius_m: 35_000 },
      });
    expect(localOverLimit.status).toBe(422);
    expect(providerErrorSchema.parse(localOverLimit.body).error).toBe("invalid_request");

    const unauthenticated = await request(trustedApp)
      .post("/api/aoi/runtime-jobs")
      .send(runtimeRequest);
    expect(unauthenticated.status).toBe(401);
    expect(providerErrorSchema.parse(unauthenticated.body).error).toBe("runtime_unauthorized");

    const trusted = await request(trustedApp)
      .post("/api/aoi/runtime-jobs")
      .set("authorization", "Bearer fixture-service-token")
      .send(runtimeRequest);
    expect(trusted.status).toBe(202);
  });

  it("allows read-only endpoints in disabled mode", async () => {
    const response = await request(disabledApp).get("/api/aoi/catalog");
    expect(response.status).toBe(200);

    const health = await request(disabledApp).get("/api/health");
    expect(health.status).toBe(200);

    const presentations = await request(disabledApp).get("/api/aoi/rybnik_35km/presentations");
    expect(presentations.status).toBe(200);
  });
});
