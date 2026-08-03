import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

import request from "supertest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import {
  layerListResponseSchema,
  providerErrorSchema,
  providerLayerResponseSchema,
  readinessListResponseSchema,
  sourceListResponseSchema,
  domainPackListResponseSchema,
  domainPackReadResponseSchema,
  issueListResponseSchema,
  sourceAvailabilityReportSchema,
  mapPresentationListResponseSchema,
  mapPresentationResponseSchema,
  mapFeatureDetailResponseSchema,
  mapCircuitDetailResponseSchema,
  mapCircuitListResponseSchema,
} from "../types/provider.js";

describe("read-only AOI provider routes", () => {
  let temporaryDirectory: string;
  let reviewStorePath: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "mdq-issue-review-"));
    reviewStorePath = path.join(temporaryDirectory, "issue-reviews.json");
    await writeFile(reviewStorePath, '{"review_store_version":"provider_issue_reviews/v1","reviews":[]}\n');
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  function appWithReviewStore() {
    return createApp({ issueStorePaths: { reviewsPath: reviewStorePath } });
  }

  async function writeFixtureDomainPack(options?: { sourceId?: string; publicExport?: boolean }) {
    const aoiId = "fixture_aoi";
    const domain = "water";
    const artifactId = "water.main";
    const packRoot = path.join(temporaryDirectory, aoiId, domain, "domain-pack-v2");
    await mkdir(path.join(packRoot, "layers"), { recursive: true });
    await mkdir(path.join(packRoot, "validation"), { recursive: true });
    await mkdir(path.join(packRoot, "readiness"), { recursive: true });
    const metadata = {
      cache_layout_version: "provider_cache/v1",
      geojson_contract_version: "provider_geojson/v1",
      contract_version: "provider_geojson/v1",
      aoi_id: aoiId,
      domain,
      layer_id: artifactId,
      source: "Fixture source",
      source_type: "analytical_vector",
      source_query: "fixture query",
      snapshot_at: "2026-08-01T00:00:00Z",
      validation_status_raw: "pass",
      quality_status: "passed",
      confidence: "medium",
      limitations: ["Fixture limitations are visible in the preview."],
      eligible_for_analysis: true,
      readiness: "usable_with_limitations",
      feature_count: 1,
    };
    const layer = {
      type: "FeatureCollection",
      metadata,
      features: [{
        type: "Feature",
        properties: {
          asset_type: "fixture main",
          source: "Fixture source",
          confidence: "medium",
          limitations: ["Fixture limitations are visible in the preview."],
        },
        geometry: { type: "Point", coordinates: [18.5, 50.1] },
      }],
    };
    const layerPayload = Buffer.from(JSON.stringify(layer));
    const sourceId = options?.sourceId ?? "openstreetmap";
    const publicExport = options?.publicExport ?? true;
    const sourceProvenance = [{ source_id: sourceId, contribution_role: "primary" }];
    const cacheMetadata = { ...metadata };
    delete (cacheMetadata as Record<string, unknown>).contract_version;
    const validation = {
      ...cacheMetadata,
      source_registry_id: sourceId,
      source_url: "https://example.test/source",
      pipeline_version: "fixture/v1",
      query_version: "fixture-query/v1",
    };
    await writeFile(path.join(packRoot, "layers", "water.main.geojson"), layerPayload);
    await writeFile(path.join(packRoot, "validation", "metadata.json"), JSON.stringify(validation));
    await writeFile(path.join(packRoot, "readiness", "readiness.json"), JSON.stringify({
      cache_layout_version: "provider_cache/v1",
      aoi_id: aoiId,
      domain,
      layer_id: artifactId,
      readiness: "usable_with_limitations",
      quality_status: "passed",
      highest_issue_severity: null,
      feature_count: 1,
      evaluated_at: "2026-08-01T00:00:00Z",
    }));
    await writeFile(path.join(packRoot, "manifest.json"), JSON.stringify({
      domain_pack_version: "provider_domain_pack/v2",
      aoi_id: aoiId,
      domain,
      source_provenance: sourceProvenance,
      artifacts: [
        {
          id: artifactId,
          kind: "processed_vector",
          format: "geojson",
          path: "layers/water.main.geojson",
          sha256: createHash("sha256").update(layerPayload).digest("hex"),
          feature_count: 1,
          source_provenance: sourceProvenance,
          public_export: publicExport,
        },
        {
          id: "water.reference",
          kind: "remote_service",
          format: "wms",
          source_provenance: [{ source_id: "kiut_gesut_wms", contribution_role: "validation_reference" }],
          public_export: false,
        },
      ],
      validation: { path: "validation/metadata.json" },
      readiness: { path: "readiness/readiness.json" },
    }));
    return { aoiId, domain, app: createApp({ providerDataPaths: { cacheRoot: temporaryDirectory } }) };
  }

  it("lists cached Rybnik layers", async () => {
    const response = await request(createApp()).get("/api/aoi/rybnik_60km/layers");

    expect(response.status).toBe(200);
    expect(layerListResponseSchema.parse(response.body).layers).toEqual(expect.arrayContaining([
      expect.objectContaining({ domain: "power", feature_count: 16_505, source_type: "analytical_vector" }),
      expect.objectContaining({ domain: "emergency", feature_count: 4, source_type: "analytical_vector" }),
    ]));
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
    expect(readinessListResponseSchema.parse(response.body).readiness).toEqual(expect.arrayContaining([
      expect.objectContaining({ domain: "power", readiness: "usable_with_limitations", highest_issue_severity: "medium" }),
      expect.objectContaining({ domain: "emergency", readiness: "usable_with_limitations" }),
    ]));
  });

  it("returns source classifications for the cached AOI", async () => {
    const response = await request(createApp()).get("/api/aoi/rybnik_60km/sources");

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
    const response = await request(createApp()).get("/api/aoi/rybnik_60km/source-availability");
    expect(response.status).toBe(200);
    const report = sourceAvailabilityReportSchema.parse(response.body);
    expect(report.sources).toHaveLength(7);
    expect(report.sources.find((source) => source.source_id === "openstreetmap")).toMatchObject({ feature_state: "available", actionable_gap: false });
    expect(report.sources.find((source) => source.source_id === "prg_wfs")).toMatchObject({ feature_state: "available", actionable_gap: false });
  });

  it("serves a v2 domain pack from the manifest without domain-specific route code", async () => {
    const response = await request(createApp()).get("/api/aoi/rybnik_60km/domain-packs/power");
    expect(response.status).toBe(200);
    const pack = domainPackReadResponseSchema.parse(response.body);
    expect(pack.layers).toEqual(expect.arrayContaining([
      expect.objectContaining({ artifact: expect.objectContaining({ id: "power.lines", public_export: true }), layer: expect.objectContaining({ metadata: expect.objectContaining({ domain: "power" }) }) }),
      expect.objectContaining({ artifact: expect.objectContaining({ id: "power.assets", public_export: true }), layer: expect.objectContaining({ metadata: expect.objectContaining({ layer_id: "power.assets" }) }) }),
    ]));
    expect(pack.layers.map((layer) => layer.artifact.kind)).toEqual(["processed_vector", "processed_vector", "processed_vector"]);
    expect(pack.source_provenance).toEqual([
      { source_id: "openstreetmap", contribution_role: "primary" },
      { source_id: "kiut_gesut_wms", contribution_role: "validation_reference" },
    ]);
  });

  it("serves compact MapLibre presentation metadata without loading public GeoJSON into the response", async () => {
    const response = await request(createApp()).get("/api/aoi/rybnik_60km/presentations");

    expect(response.status).toBe(200);
    const listed = mapPresentationListResponseSchema.parse(response.body);
    const presentation = listed.presentations.find((candidate) => candidate.domain === "power");
    expect(presentation && mapPresentationResponseSchema.parse(presentation)).toMatchObject({
      domain: "power",
      archive: expect.objectContaining({ format: "pmtiles", min_zoom: 7, max_zoom: 14 }),
      layers: expect.arrayContaining([expect.objectContaining({ artifact_id: "power.lines", source_layer: "power_lines", feature_count: 16_505 })]),
    });
    expect(JSON.stringify(response.body)).not.toContain("way/32043840");
    expect(JSON.stringify(response.body)).not.toContain("osm_tags");
  });

  it("serves PMTiles as a bounded byte range and rejects an unbounded archive request", async () => {
    const archiveUrl = "/api/aoi/rybnik_60km/presentations/power/archive";
    const partial = await request(createApp()).get(archiveUrl).set("range", "bytes=0-126");

    expect(partial.status).toBe(206);
    expect(partial.headers["accept-ranges"]).toBe("bytes");
    expect(partial.headers["content-range"]).toMatch(/^bytes 0-126\/\d+$/);
    expect(partial.headers.etag).toMatch(/^"[a-f0-9]{64}"$/);
    expect(partial.headers["cache-control"]).toBe("public, max-age=0, must-revalidate");
    expect(partial.headers["content-length"]).toBe("127");

    const unbounded = await request(createApp()).get(archiveUrl);
    expect(unbounded.status).toBe(416);
    expect(providerErrorSchema.parse(unbounded.body)).toMatchObject({ error: "invalid_request" });
  });

  it("serves one validated public map feature without serializing its layer", async () => {
    const response = await request(createApp()).get("/api/aoi/rybnik_60km/presentations/power/features/node%2F1528794574");

    expect(response.status).toBe(200);
    expect(mapFeatureDetailResponseSchema.parse(response.body)).toMatchObject({
      artifact_id: "power.supports",
      source_id: "node/1528794574",
      feature: { properties: { asset_type: "tower", osm_tags: { power: "tower", operator: "Tauron" } } },
    });
    expect(JSON.stringify(response.body)).not.toContain("generator:method");

    const malformed = await request(createApp()).get("/api/aoi/rybnik_60km/presentations/power/features/not-an-osm-id");
    expect(malformed.status).toBe(422);
    const missing = await request(createApp()).get("/api/aoi/rybnik_60km/presentations/power/features/node%2F1");
    expect(missing.status).toBe(404);

    const plant = await request(createApp()).get("/api/aoi/rybnik_60km/presentations/power/features/relation%2F12825526");
    expect(plant.status).toBe(200);
    expect(mapFeatureDetailResponseSchema.parse(plant.body)).toMatchObject({
      feature: { properties: { osm_tags: { wikipedia: "pl:Elektrownia Rybnik", wikidata: "Q751203", website: "https://elrybnik.pgegiek.pl/o-oddziale" } } },
    });
  });

  it("serves emergency community geometry and distinct official PRG representative evidence", async () => {
    const presentations = await request(createApp()).get("/api/aoi/rybnik_60km/presentations");
    expect(presentations.status).toBe(200);
    expect(presentations.body.presentations).toEqual(expect.arrayContaining([
      expect.objectContaining({ domain: "emergency", layers: expect.arrayContaining([
        expect.objectContaining({ artifact_id: "emergency.hospital" }),
        expect.objectContaining({ artifact_id: "emergency.official_police" }),
      ]) }),
    ]));

    const hospital = await request(createApp()).get("/api/aoi/rybnik_60km/presentations/emergency/features/way%2F39829907");
    expect(hospital.status).toBe(200);
    expect(mapFeatureDetailResponseSchema.parse(hospital.body)).toMatchObject({
      artifact_id: "emergency.hospital", source_id: "way/39829907", feature: { geometry: { type: "Polygon" }, properties: { source: "OpenStreetMap", asset_type: "hospital", osm_tags: { amenity: "hospital" } } },
    });

    const officialPolice = await request(createApp()).get("/api/aoi/rybnik_60km/presentations/emergency/features/prg_k02%2F1350186");
    expect(officialPolice.status).toBe(200);
    expect(mapFeatureDetailResponseSchema.parse(officialPolice.body)).toMatchObject({
      artifact_id: "emergency.official_police", source_id: "prg_k02/1350186",
      feature: { geometry: { type: "Point" }, properties: { source: "PRG (official unit-area evidence)", source_geometry_type: "MultiSurface", source_attributes: { official_type: "K02_Komenda_powiatowa_policji" } } },
    });
  });

  it("lists only committed circuits and returns one selected circuit", async () => {
    const available = await request(createApp()).get("/api/aoi/rybnik_60km/presentations/power/features/way%2F185080408/circuits");
    expect(available.status).toBe(200);
    expect(mapCircuitListResponseSchema.parse(available.body)).toMatchObject({ state: "available", circuits: [expect.objectContaining({ relation_id: "relation/19511895", aoi_coverage: "bounded_source_snapshot" })] });
    const detail = await request(createApp()).get("/api/aoi/rybnik_60km/presentations/power/circuits/relation%2F19511895");
    expect(detail.status).toBe(200);
    expect(mapCircuitDetailResponseSchema.parse(detail.body)).toMatchObject({ circuit: { relation_id: "relation/19511895" } });
    expect(Object.keys((detail.body.circuit as { tags: object }).tags)).not.toContain("flow");
    const absent = await request(createApp()).get("/api/aoi/rybnik_60km/presentations/power/features/node%2F314662971/circuits");
    expect(mapCircuitListResponseSchema.parse(absent.body)).toMatchObject({ state: "not_applicable", circuits: [] });
  });

  it("discovers a fixture domain solely from its v2 manifest", async () => {
    const fixture = await writeFixtureDomainPack();
    const listed = await request(fixture.app).get(`/api/aoi/${fixture.aoiId}/domain-packs`);
    expect(listed.status).toBe(200);
    expect(domainPackListResponseSchema.parse(listed.body).domain_packs).toEqual([
      expect.objectContaining({ domain: fixture.domain, layers: [expect.objectContaining({ artifact: expect.objectContaining({ id: "water.main" }) })] }),
    ]);
    const read = await request(fixture.app).get(`/api/aoi/${fixture.aoiId}/domain-packs/${fixture.domain}`);
    expect(read.status).toBe(200);
    expect(domainPackReadResponseSchema.parse(read.body).layers[0]?.layer.metadata.limitations).toContain("Fixture limitations are visible in the preview.");
  });

  it("rejects a public analytical artifact whose provenance is reference-only", async () => {
    const fixture = await writeFixtureDomainPack({ sourceId: "kiut_gesut_wms" });
    const response = await request(fixture.app).get(`/api/aoi/${fixture.aoiId}/domain-packs/${fixture.domain}`);
    expect(response.status).toBe(404);
    expect(providerErrorSchema.parse(response.body).message).toMatch(/not eligible for public export/i);
    expect(response.body.layers).toBeUndefined();
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

  it("returns generated issue evidence with the initial open review state", async () => {
    const response = await request(appWithReviewStore()).get("/api/aoi/rybnik_60km/issues");

    expect(response.status).toBe(200);
    const issues = issueListResponseSchema.parse(response.body).issues;
    expect(issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "DQ-MANUAL-SEEDS-NON-AUTHORITATIVE",
        rule_id: "manual.non_authoritative",
        review: { status: "open", note: null, created_at: null, updated_at: null },
      }),
    ]));
  });

  it("rejects a malformed AOI before reading issue storage", async () => {
    const response = await request(appWithReviewStore()).get("/api/aoi/Rybnik-60km/issues");

    expect(response.status).toBe(422);
    expect(providerErrorSchema.parse(response.body)).toMatchObject({ error: "invalid_request" });
  });

  it("persists a valid review across a new application instance", async () => {
    const update = await request(appWithReviewStore())
      .patch("/api/aoi/rybnik_60km/issues/DQ-MANUAL-SEEDS-NON-AUTHORITATIVE/review")
      .send({ status: "acknowledged", note: "Reviewed as an intentional manual seed.", expected_updated_at: null });

    expect(update.status).toBe(200);
    expect(update.body.review).toMatchObject({ status: "acknowledged", note: "Reviewed as an intentional manual seed." });
    const listed = await request(appWithReviewStore()).get("/api/aoi/rybnik_60km/issues");
    const issue = issueListResponseSchema.parse(listed.body).issues.find((item) => item.id === update.body.id);
    expect(issue?.review).toEqual(update.body.review);
  });

  it("rejects malformed updates and invalid lifecycle transitions", async () => {
    const malformed = await request(appWithReviewStore())
      .patch("/api/aoi/rybnik_60km/issues/DQ-MANUAL-SEEDS-NON-AUTHORITATIVE/review")
      .send({ status: "invalid" });
    expect(malformed.status).toBe(422);
    expect(providerErrorSchema.parse(malformed.body)).toMatchObject({ error: "invalid_request" });

    const acknowledged = await request(appWithReviewStore())
      .patch("/api/aoi/rybnik_60km/issues/DQ-MANUAL-SEEDS-NON-AUTHORITATIVE/review")
      .send({ status: "acknowledged", expected_updated_at: null });
    const invalidTransition = await request(appWithReviewStore())
      .patch("/api/aoi/rybnik_60km/issues/DQ-MANUAL-SEEDS-NON-AUTHORITATIVE/review")
      .send({ status: "open", expected_updated_at: acknowledged.body.review.updated_at });
    expect(invalidTransition.status).toBe(422);
    expect(providerErrorSchema.parse(invalidTransition.body)).toMatchObject({ error: "invalid_request" });
  });

  it("rejects stale review updates instead of overwriting them", async () => {
    const acknowledged = await request(appWithReviewStore())
      .patch("/api/aoi/rybnik_60km/issues/DQ-MANUAL-SEEDS-NON-AUTHORITATIVE/review")
      .send({ status: "acknowledged", expected_updated_at: null });
    const resolved = await request(appWithReviewStore())
      .patch("/api/aoi/rybnik_60km/issues/DQ-MANUAL-SEEDS-NON-AUTHORITATIVE/review")
      .send({ status: "resolved", expected_updated_at: acknowledged.body.review.updated_at });
    expect(resolved.status).toBe(200);

    const stale = await request(appWithReviewStore())
      .patch("/api/aoi/rybnik_60km/issues/DQ-MANUAL-SEEDS-NON-AUTHORITATIVE/review")
      .send({ status: "accepted", expected_updated_at: acknowledged.body.review.updated_at });
    expect(stale.status).toBe(409);
    expect(providerErrorSchema.parse(stale.body)).toMatchObject({ error: "conflict" });
  });

  it("serializes concurrent review writes so only one update can use a revision", async () => {
    const acknowledged = await request(appWithReviewStore())
      .patch("/api/aoi/rybnik_60km/issues/DQ-MANUAL-SEEDS-NON-AUTHORITATIVE/review")
      .send({ status: "acknowledged", expected_updated_at: null });
    const expectedUpdatedAt = acknowledged.body.review.updated_at;

    const [accepted, ignored] = await Promise.all([
      request(appWithReviewStore())
        .patch("/api/aoi/rybnik_60km/issues/DQ-MANUAL-SEEDS-NON-AUTHORITATIVE/review")
        .send({ status: "accepted", expected_updated_at: expectedUpdatedAt }),
      request(appWithReviewStore())
        .patch("/api/aoi/rybnik_60km/issues/DQ-MANUAL-SEEDS-NON-AUTHORITATIVE/review")
        .send({ status: "ignored", expected_updated_at: expectedUpdatedAt }),
    ]);

    expect([accepted.status, ignored.status].sort()).toEqual([200, 409]);
  });

  it("does not attach a review when a regenerated issue identity changes", async () => {
    const update = await request(appWithReviewStore())
      .patch("/api/aoi/rybnik_60km/issues/DQ-MANUAL-SEEDS-NON-AUTHORITATIVE/review")
      .send({ status: "accepted", expected_updated_at: null });
    expect(update.status).toBe(200);

    const changedSnapshotPath = path.join(temporaryDirectory, "changed-issues.json");
    const originalSnapshot = JSON.parse(await readFile(path.resolve("../backend/data/issues/rybnik_60km.json"), "utf8")) as { issues: Array<Record<string, unknown>> };
    const changedIssue = originalSnapshot.issues[0];
    if (!changedIssue) throw new Error("Expected the generated issue fixture to contain an issue.");
    changedIssue.rule_version = "2.0";
    await writeFile(changedSnapshotPath, `${JSON.stringify(originalSnapshot)}\n`);
    const response = await request(createApp({ issueStorePaths: { reviewsPath: reviewStorePath, generatedIssuesPath: changedSnapshotPath } }))
      .get("/api/aoi/rybnik_60km/issues");
    const issue = issueListResponseSchema.parse(response.body).issues.find((item) => item.id === "DQ-MANUAL-SEEDS-NON-AUTHORITATIVE");
    expect(issue?.review.status).toBe("open");
  });
});
