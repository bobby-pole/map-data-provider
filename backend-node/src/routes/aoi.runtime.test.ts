import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import { seedCompactRybnikCache } from "../test/fixtures.js";
import {
  administrativeBoundaryResponseSchema,
  administrativeCatalogResponseSchema,
  providerErrorSchema,
  providerRuntimePreflightResponseSchema,
} from "../types/provider.js";

describe("AOI runtime catalog, boundary, and preflight routes", () => {
  let fixtureCacheDir: string;
  let defaultApp: ReturnType<typeof createApp>;

  beforeAll(async () => {
    fixtureCacheDir = await mkdtemp(path.join(os.tmpdir(), "mdq-runtime-cache-"));
    await seedCompactRybnikCache(fixtureCacheDir);
    defaultApp = createApp({
      providerDataPaths: { cacheRoot: fixtureCacheDir },
      runtimePolicy: { mode: "local_bounded" },
    });
  });

  afterAll(async () => {
    await rm(fixtureCacheDir, { recursive: true, force: true });
  });

  it("rejects malformed runtime requests before a local worker is invoked", async () => {
    const response = await request(defaultApp)
      .post("/api/aoi/runtime-requests")
      .send({ aoi: { type: "point_radius" }, profiles: ["unknown"] });
    expect(response.status).toBe(422);
    expect(providerErrorSchema.parse(response.body)).toMatchObject({ error: "invalid_request" });
  });

  it("serves a compact national PRG hierarchy and resolves a selected real boundary", async () => {
    const catalog = await request(defaultApp).get("/api/aoi/catalog");
    expect(catalog.status).toBe(200);
    expect(administrativeCatalogResponseSchema.parse(catalog.body).units).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "voivodeship_24", kind: "voivodeship" }),
        expect.objectContaining({ id: "gmina_2473011", parent_id: "county_2473" }),
      ]),
    );
    expect(catalog.body.units).toHaveLength(2_875);
    expect(catalog.body.units[0]).not.toHaveProperty("geometry");

    const boundary = await request(defaultApp)
      .post("/api/aoi/catalog/boundary")
      .send({ unit_ids: ["gmina_2473011"] });
    expect(boundary.status).toBe(200);
    expect(administrativeBoundaryResponseSchema.parse(boundary.body)).toMatchObject({
      within_provider_area_limit: true,
      aoi: {
        input_type: "administrative_selection",
        boundary_provenance: { source_registry_id: "prg_wfs" },
      },
    });
  });

  it("returns a typed administrative preflight before a worker can contact Overpass", async () => {
    const response = await request(defaultApp)
      .post("/api/aoi/runtime-requests/preflight")
      .send({
        aoi: { type: "administrative_selection", unit_ids: ["gmina_2473011"] },
        profiles: ["power"],
      });
    expect(response.status).toBe(200);
    expect(providerRuntimePreflightResponseSchema.parse(response.body)).toMatchObject({
      status: "ready",
      code: "bounded_provider_request",
      aoi: { input_type: "administrative_selection" },
    });
  });

  it("rejects selecting an entire voivodeship", async () => {
    const response = await request(defaultApp)
      .post("/api/aoi/catalog/boundary")
      .send({ unit_ids: ["voivodeship_14"] });
    expect(response.status).toBe(422);
    expect(providerErrorSchema.parse(response.body)).toMatchObject({
      error: "invalid_request",
      message: expect.stringContaining("entire voivodeship"),
    });
  });

  it("rejects a PRG selection spanning more than one voivodeship", async () => {
    const response = await request(defaultApp)
      .post("/api/aoi/catalog/boundary")
      .send({ unit_ids: ["county_1465", "county_2473"] });
    expect(response.status).toBe(422);
    expect(providerErrorSchema.parse(response.body)).toMatchObject({
      error: "invalid_request",
      message: expect.stringContaining("one voivodeship"),
    });
  });

  it("rejects non-adjacent counties in the same voivodeship", async () => {
    const response = await request(defaultApp)
      .post("/api/aoi/catalog/boundary")
      .send({ unit_ids: ["county_2473", "county_2464"] });
    expect(response.status).toBe(422);
    expect(providerErrorSchema.parse(response.body)).toMatchObject({
      error: "invalid_request",
      message: expect.stringContaining("directly adjacent"),
    });
  });
});
