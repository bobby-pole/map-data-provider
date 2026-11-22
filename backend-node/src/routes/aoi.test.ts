import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import { seedCompactRybnikCache, writeFixtureDomainPack } from "../test/fixtures.js";
import {
  domainPackReadResponseSchema,
  layerListResponseSchema,
  multiDomainExportResponseSchema,
  providerErrorSchema,
  providerLayerResponseSchema,
  readinessListResponseSchema,
  sourceAvailabilityReportSchema,
  sourceListResponseSchema,
} from "../types/provider.js";

describe("AOI layer, domain-pack, source, and export routes", () => {
  let temporaryDirectory: string;
  let fixtureCacheDir: string;
  let defaultApp: ReturnType<typeof createApp>;

  beforeAll(async () => {
    fixtureCacheDir = await mkdtemp(path.join(os.tmpdir(), "mdq-fixture-cache-"));
    await seedCompactRybnikCache(fixtureCacheDir);
    defaultApp = createApp({
      providerDataPaths: { cacheRoot: fixtureCacheDir },
      runtimePolicy: { mode: "local_bounded" },
    });
  });

  afterAll(async () => {
    await rm(fixtureCacheDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "mdq-aoi-data-"));
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it("lists cached Rybnik layers", async () => {
    const response = await request(defaultApp).get("/api/aoi/rybnik_35km/layers");

    expect(response.status).toBe(200);
    expect(layerListResponseSchema.parse(response.body).layers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ domain: "power", source_type: "analytical_vector" }),
        expect.objectContaining({ domain: "emergency", source_type: "analytical_vector" }),
        expect.objectContaining({ domain: "gas", source_type: "analytical_vector" }),
        expect.objectContaining({ domain: "telecom", source_type: "analytical_vector" }),
        expect.objectContaining({ domain: "district_heating", source_type: "analytical_vector" }),
      ]),
    );
  });

  it("returns the cached Rybnik power GeoJSON contract", async () => {
    const response = await request(defaultApp).get("/api/aoi/rybnik_35km/layers/power");

    expect(response.status).toBe(200);
    const layer = providerLayerResponseSchema.parse(response.body);
    expect(layer.metadata).toMatchObject({ aoi_id: "rybnik_35km", domain: "power" });
    expect(layer.features.length).toBeGreaterThan(0);
  });

  it("returns the versioned Rybnik gas contract with explicit fixture limitations", async () => {
    const response = await request(defaultApp).get("/api/aoi/rybnik_35km/layers/gas");

    expect(response.status).toBe(200);
    const layer = providerLayerResponseSchema.parse(response.body);
    expect(layer.metadata).toMatchObject({
      aoi_id: "rybnik_35km",
      domain: "gas",
      query_version: "gas-osm/v2",
    });
    expect(layer.metadata.feature_count).toBeGreaterThan(0);
    expect(layer.metadata.limitations).toEqual(
      expect.arrayContaining([expect.stringMatching(/not a complete Rybnik 35 km OSM snapshot/i)]),
    );
  });

  it("returns the telecom contract with an explicit missing-network source gap", async () => {
    const response = await request(defaultApp).get("/api/aoi/rybnik_35km/layers/telecom");

    expect(response.status).toBe(200);
    const layer = providerLayerResponseSchema.parse(response.body);
    expect(layer.metadata).toMatchObject({
      aoi_id: "rybnik_35km",
      domain: "telecom",
      query_version: "telecom-osm/v1",
    });
    expect(layer.metadata.feature_count).toBeGreaterThan(0);
    expect(layer.metadata.limitations).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/KIUT telecom WMS layers are visual reference overlays only/i),
      ]),
    );
  });

  it("returns the district-heating contract with an explicit missing-network source gap", async () => {
    const response = await request(defaultApp).get("/api/aoi/rybnik_35km/layers/district_heating");

    expect(response.status).toBe(200);
    const layer = providerLayerResponseSchema.parse(response.body);
    expect(layer.metadata).toMatchObject({
      aoi_id: "rybnik_35km",
      domain: "district_heating",
      query_version: "district-heating-osm/v1",
    });
    expect(layer.metadata.feature_count).toBeGreaterThan(0);
    expect(layer.metadata.limitations).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/KIUT district-heating WMS is visual reference-only imagery/i),
      ]),
    );
  });

  it("returns cached readiness without invoking a worker", async () => {
    const response = await request(defaultApp).get("/api/aoi/rybnik_35km/readiness");

    expect(response.status).toBe(200);
    expect(readinessListResponseSchema.parse(response.body).readiness).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          domain: "power",
          readiness: "usable_with_limitations",
          highest_issue_severity: "medium",
        }),
        expect.objectContaining({ domain: "emergency", readiness: "usable_with_limitations" }),
      ]),
    );
  });

  it("returns source classifications for the cached AOI", async () => {
    const response = await request(defaultApp).get("/api/aoi/rybnik_35km/sources");

    expect(response.status).toBe(200);
    const sources = sourceListResponseSchema.parse(response.body).sources;
    expect(sources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "openstreetmap", source_type: "analytical_vector" }),
        expect.objectContaining({ id: "manual_power_seed", source_type: "manual_seed" }),
        expect.objectContaining({ id: "kiut_gesut_wms", source_type: "reference_overlay" }),
      ]),
    );
  });

  it("serves the committed source availability report without probing a remote service", async () => {
    const response = await request(defaultApp).get("/api/aoi/rybnik_35km/source-availability");
    expect(response.status).toBe(200);
    const report = sourceAvailabilityReportSchema.parse(response.body);
    expect(report.sources).toHaveLength(7);
    expect(report.sources.find((source) => source.source_id === "openstreetmap")).toMatchObject({
      feature_state: "available",
      actionable_gap: false,
    });
    expect(report.sources.find((source) => source.source_id === "prg_wfs")).toMatchObject({
      feature_state: "available",
      actionable_gap: false,
    });
  });

  it("serves a synthesized source availability report for dynamic runtime AOIs", async () => {
    const response = await request(defaultApp).get("/api/aoi/custom_aoi_999/source-availability");
    expect(response.status).toBe(200);
    const report = sourceAvailabilityReportSchema.parse(response.body);
    expect(report.aoi_id).toBe("custom_aoi_999");
    expect(report.sources).toHaveLength(7);
    expect(report.sources.find((source) => source.source_id === "openstreetmap")).toMatchObject({
      availability: "available",
      actionable_gap: false,
    });
    expect(report.sources.find((source) => source.source_id === "bdot10k")).toMatchObject({
      availability: "available",
      actionable_gap: true,
    });
  });

  it("serves a v2 domain pack from the manifest without domain-specific route code", async () => {
    const response = await request(defaultApp).get("/api/aoi/rybnik_35km/domain-packs/power");
    expect(response.status).toBe(200);
    const pack = domainPackReadResponseSchema.parse(response.body);
    expect(pack.layers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artifact: expect.objectContaining({ id: "power.lines", public_export: true }),
          layer: expect.objectContaining({
            metadata: expect.objectContaining({ domain: "power" }),
          }),
        }),
        expect.objectContaining({
          artifact: expect.objectContaining({ id: "power.assets", public_export: true }),
          layer: expect.objectContaining({
            metadata: expect.objectContaining({ layer_id: "power.assets" }),
          }),
        }),
      ]),
    );
    expect(pack.layers.map((layer) => layer.artifact.kind)).toEqual([
      "processed_vector",
      "processed_vector",
      "processed_vector",
    ]);
    expect(pack.source_provenance).toEqual([
      { source_id: "openstreetmap", contribution_role: "primary" },
      { source_id: "kiut_gesut_wms", contribution_role: "validation_reference" },
    ]);
  }, 10_000);

  it("serves a multi-domain export with filtering and issues", async () => {
    const response = await request(defaultApp).get(
      "/api/aoi/rybnik_35km/export?domains=power,emergency",
    );
    expect(response.status).toBe(200);
    const exportData = multiDomainExportResponseSchema.parse(response.body);
    expect(exportData.export_version).toBe("provider_multi_domain_export/v2");
    expect(exportData.aoi_id).toBe("rybnik_35km");
    expect(exportData.snapshot).toMatchObject({ snapshot_id: "rybnik_35km", state: "ready" });
    expect(exportData.domain_outcomes).toHaveLength(2);
    expect(exportData.domain_outcomes).toEqual(
      expect.arrayContaining([
        {
          domain: "power",
          status: "ready",
          detail: expect.stringMatching(/available/i),
          has_domain_pack: true,
        },
        {
          domain: "emergency",
          status: "ready",
          detail: expect.stringMatching(/available/i),
          has_domain_pack: true,
        },
      ]),
    );
    expect(exportData.domain_packs.length).toBe(2);
    expect(exportData.domain_packs.map((p) => p.domain)).toEqual(
      expect.arrayContaining(["power", "emergency"]),
    );
    expect(Array.isArray(exportData.issues)).toBe(true);
  }, 10_000);

  it("serves a complete 9-domain multi-domain export when all required domains are requested", async () => {
    const response = await request(defaultApp).get(
      "/api/aoi/rybnik_35km/export?domains=power,emergency,public,transport,bridges,water,gas,sewer,industrial",
    );
    expect(response.status).toBe(200);
    const exportData = multiDomainExportResponseSchema.parse(response.body);
    expect(exportData.domain_outcomes).toHaveLength(9);
    expect(exportData.domain_packs).toHaveLength(9);
  }, 15_000);

  it("rejects multi-domain export requests with missing or empty domains parameter or empty segments", async () => {
    const res1 = await request(defaultApp).get("/api/aoi/rybnik_35km/export");
    expect(res1.status).toBe(422);
    expect(providerErrorSchema.parse(res1.body)).toMatchObject({ error: "invalid_request" });

    const res2 = await request(defaultApp).get("/api/aoi/rybnik_35km/export?domains=");
    expect(res2.status).toBe(422);
    expect(providerErrorSchema.parse(res2.body)).toMatchObject({ error: "invalid_request" });

    const res3 = await request(defaultApp).get("/api/aoi/rybnik_35km/export?domains=power,,water");
    expect(res3.status).toBe(422);
    expect(providerErrorSchema.parse(res3.body)).toMatchObject({ error: "invalid_request" });

    const res4 = await request(defaultApp).get("/api/aoi/rybnik_35km/export?domains=power,");
    expect(res4.status).toBe(422);
    expect(providerErrorSchema.parse(res4.body)).toMatchObject({ error: "invalid_request" });

    const res5 = await request(defaultApp).get("/api/aoi/rybnik_35km/export?domains=,power");
    expect(res5.status).toBe(422);
    expect(providerErrorSchema.parse(res5.body)).toMatchObject({ error: "invalid_request" });
  });

  it("rejects multi-domain export requests with unallowed or unknown domain parameters", async () => {
    const response = await request(defaultApp).get(
      "/api/aoi/rybnik_35km/export?domains=power,unknown_domain",
    );
    expect(response.status).toBe(422);
    expect(providerErrorSchema.parse(response.body)).toMatchObject({ error: "invalid_request" });
  });

  it("deduplicates requested domain parameters", async () => {
    const response = await request(defaultApp).get(
      "/api/aoi/rybnik_35km/export?domains=power,power",
    );
    expect(response.status).toBe(200);
    const exportData = multiDomainExportResponseSchema.parse(response.body);
    expect(exportData.domain_outcomes).toHaveLength(1);
    expect(exportData.domain_outcomes[0]?.domain).toBe("power");
    expect(exportData.domain_packs).toHaveLength(1);
  });

  it("handles missing cached domain packs by returning explicit needs_source outcomes without failing HTTP status", async () => {
    const { app } = await writeFixtureDomainPack(temporaryDirectory);
    const response = await request(app).get("/api/aoi/fixture_aoi/export?domains=water,power");
    expect(response.status).toBe(200);
    const exportData = multiDomainExportResponseSchema.parse(response.body);
    expect(exportData.domain_outcomes).toEqual([
      {
        domain: "water",
        status: "ready",
        detail: "Domain pack for 'water' is available.",
        has_domain_pack: true,
      },
      {
        domain: "power",
        status: "needs_source",
        detail: "Snapshot 'fixture_aoi' has no published 'power' domain.",
        has_domain_pack: false,
      },
    ]);
    expect(exportData.domain_packs).toHaveLength(1);
    expect(exportData.domain_packs[0]?.domain).toBe("water");
  });

  it("returns 200 for the cached industrial domain pack", async () => {
    const response = await request(defaultApp).get("/api/aoi/rybnik_35km/domain-packs/industrial");
    expect(response.status).toBe(200);
    expect(domainPackReadResponseSchema.parse(response.body).domain).toBe("industrial");
  });

  it("returns the cached telecom pack without exporting the KIUT reference", async () => {
    const response = await request(defaultApp).get("/api/aoi/rybnik_35km/domain-packs/telecom");
    expect(response.status).toBe(200);
    const pack = domainPackReadResponseSchema.parse(response.body);
    expect(pack.domain).toBe("telecom");
    expect(pack.layers.map((layer) => layer.artifact.id)).toEqual([
      "telecom.towers",
      "telecom.facilities",
      "telecom.lines",
      "telecom.inspection_points",
    ]);
    expect(["available", "usable_with_limitations", "needs_source"]).toContain(
      pack.layers.find((layer) => layer.artifact.id === "telecom.lines")?.layer.metadata.readiness,
    );
  });

  it("returns the cached district-heating pack without exporting the KIUT reference", async () => {
    const response = await request(defaultApp).get(
      "/api/aoi/rybnik_35km/domain-packs/district_heating",
    );
    expect(response.status).toBe(200);
    const pack = domainPackReadResponseSchema.parse(response.body);
    expect(pack.domain).toBe("district_heating");
    expect(pack.layers.map((layer) => layer.artifact.id)).toEqual([
      "district_heating.plants",
      "district_heating.facilities",
      "district_heating.lines",
      "district_heating.inspection_points",
    ]);
    expect(["available", "usable_with_limitations", "needs_source"]).toContain(
      pack.layers.find((layer) => layer.artifact.id === "district_heating.lines")?.layer.metadata
        .readiness,
    );
  });

  it("returns 422 for a malformed AOI", async () => {
    const response = await request(defaultApp).get("/api/aoi/Rybnik-35km/layers");

    expect(response.status).toBe(422);
    expect(providerErrorSchema.parse(response.body)).toMatchObject({ error: "invalid_request" });
  });

  if (process.env.MDQ_REJECT_MALFORMED_EXPORT_PROBE === "1") {
    it("probe: expects malformed export query to be accepted (intentionally fails)", async () => {
      const res = await request(createApp()).get(
        "/api/aoi/rybnik_35km/export?domains=power,,water",
      );
      expect(res.status).toBe(200);
    });
  }
});
