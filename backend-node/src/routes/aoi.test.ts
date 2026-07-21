import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import {
  layerListResponseSchema,
  providerErrorSchema,
  providerLayerResponseSchema,
  readinessListResponseSchema,
  sourceListResponseSchema,
  steelSentinelPackSchema,
} from "../types/provider.js";

describe("read-only AOI provider routes", () => {
  it("lists cached Rybnik layers", async () => {
    const response = await request(createApp()).get("/api/aoi/rybnik_60km/layers");

    expect(response.status).toBe(200);
    expect(layerListResponseSchema.parse(response.body).layers).toEqual([
      expect.objectContaining({ domain: "power", feature_count: 16_505, source_type: "analytical_vector" }),
    ]);
  });

  it("returns the cached Rybnik power GeoJSON contract", async () => {
    const response = await request(createApp()).get("/api/aoi/rybnik_60km/layers/power");

    expect(response.status).toBe(200);
    const layer = providerLayerResponseSchema.parse(response.body);
    expect(layer.metadata).toMatchObject({ aoi_id: "rybnik_60km", domain: "power", feature_count: 16_505 });
    expect(layer.features).toHaveLength(16_505);
  });

  it("returns cached readiness without invoking a worker", async () => {
    const response = await request(createApp()).get("/api/aoi/rybnik_60km/readiness");

    expect(response.status).toBe(200);
    expect(readinessListResponseSchema.parse(response.body).readiness).toEqual([
      expect.objectContaining({ domain: "power", readiness: "usable_with_limitations", highest_issue_severity: "medium" }),
    ]);
  });

  it("returns source classifications for the cached AOI", async () => {
    const response = await request(createApp()).get("/api/aoi/rybnik_60km/sources");

    expect(response.status).toBe(200);
    const sources = sourceListResponseSchema.parse(response.body).sources;
    expect(sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "openstreetmap", source_type: "analytical_vector" }),
        expect.objectContaining({ id: "manual_power_seed", source_type: "manual_seed" }),
        expect.objectContaining({ id: "kiut_gesut_wms", source_type: "reference_overlay", usable_for_simulation: false }),
      ]),
    );
  });

  it("exports a complete Steel Sentinel layer pack", async () => {
    const response = await request(createApp()).get("/api/aoi/rybnik_60km/exports/steel-sentinel-pack");

    expect(response.status).toBe(200);
    const pack = steelSentinelPackSchema.parse(response.body);
    expect(pack.layers.power.layer.metadata.feature_count).toBe(16_505);
    expect(pack.layers.power.metadata.domain).toBe("power");
    expect(pack.layers.power.readiness.readiness).toBe("usable_with_limitations");
    expect(pack.sources.sources).toEqual(expect.arrayContaining([expect.objectContaining({ source_type: "reference_overlay" })]));
  });

  it("does not fabricate a pack for missing cache", async () => {
    const response = await request(createApp()).get("/api/aoi/missing_aoi/exports/steel-sentinel-pack");

    expect(response.status).toBe(404);
    expect(providerErrorSchema.parse(response.body)).toMatchObject({ error: "not_found" });
  });

  it("returns 404 for a missing cached domain", async () => {
    const response = await request(createApp()).get("/api/aoi/rybnik_60km/layers/transport");

    expect(response.status).toBe(404);
    expect(providerErrorSchema.parse(response.body)).toMatchObject({ error: "not_found" });
  });

  it("returns 422 for a malformed AOI", async () => {
    const response = await request(createApp()).get("/api/aoi/Rybnik-60km/layers");

    expect(response.status).toBe(422);
    expect(providerErrorSchema.parse(response.body)).toMatchObject({ error: "invalid_request" });
  });
});
