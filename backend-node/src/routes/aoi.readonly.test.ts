import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import { providerErrorSchema } from "../types/provider.js";
import { seedCompactRybnikCache } from "./testFixtures.js";

describe("read-only demo mode protection", () => {
  let fixtureCacheDir: string;
  let readOnlyApp: ReturnType<typeof createApp>;

  beforeAll(async () => {
    fixtureCacheDir = await mkdtemp(path.join(os.tmpdir(), "mdq-readonly-cache-"));
    await seedCompactRybnikCache(fixtureCacheDir);
    readOnlyApp = createApp({
      readOnlyMode: true,
      providerDataPaths: { cacheRoot: fixtureCacheDir },
    });
  });

  afterAll(async () => {
    await rm(fixtureCacheDir, { recursive: true, force: true });
  });

  it("rejects POST /api/aoi/requests with runtime_disabled", async () => {
    const response = await request(readOnlyApp)
      .post("/api/aoi/requests")
      .send({ aoi_id: "rybnik_35km", domain: "power" });

    expect(response.status).toBe(403);
    const parsed = providerErrorSchema.parse(response.body);
    expect(parsed.error).toBe("runtime_disabled");
    expect(parsed.message).toContain("disabled in public demo mode");
  });

  it("rejects POST /api/aoi/runtime-requests with runtime_disabled", async () => {
    const response = await request(readOnlyApp)
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
    expect(parsed.message).toContain("disabled in public demo mode");
  });

  it("rejects POST /api/aoi/runtime-jobs with runtime_disabled", async () => {
    const response = await request(readOnlyApp)
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
    expect(parsed.message).toContain("disabled in public demo mode");
  });

  it("allows read-only endpoints in demo mode", async () => {
    const response = await request(readOnlyApp).get("/api/aoi/catalog");
    expect(response.status).toBe(200);

    const health = await request(readOnlyApp).get("/api/health");
    expect(health.status).toBe(200);

    const presentations = await request(readOnlyApp).get("/api/aoi/rybnik_35km/presentations");
    expect(presentations.status).toBe(200);
  });
});
