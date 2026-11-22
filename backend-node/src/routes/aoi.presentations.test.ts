import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import { seedCompactRybnikCache } from "../test/fixtures.js";
import {
  mapCircuitDetailResponseSchema,
  mapCircuitListResponseSchema,
  mapFeatureDetailResponseSchema,
  mapPresentationListResponseSchema,
  mapPresentationResponseSchema,
  providerErrorSchema,
} from "../types/provider.js";

describe("AOI map presentation, PMTiles range, feature detail, and circuit routes", () => {
  let fixtureCacheDir: string;
  let defaultApp: ReturnType<typeof createApp>;

  beforeAll(async () => {
    fixtureCacheDir = await mkdtemp(path.join(os.tmpdir(), "mdq-presentation-cache-"));
    await seedCompactRybnikCache(fixtureCacheDir);
    defaultApp = createApp({
      providerDataPaths: { cacheRoot: fixtureCacheDir },
      runtimePolicy: { mode: "local_bounded" },
    });
  });

  afterAll(async () => {
    await rm(fixtureCacheDir, { recursive: true, force: true });
  });

  it("serves compact MapLibre presentation metadata without loading public GeoJSON into the response", async () => {
    const response = await request(defaultApp).get("/api/aoi/rybnik_35km/presentations");

    expect(response.status).toBe(200);
    const listed = mapPresentationListResponseSchema.parse(response.body);
    const presentation = listed.presentations.find((candidate) => candidate.domain === "power");
    expect(presentation && mapPresentationResponseSchema.parse(presentation)).toMatchObject({
      domain: "power",
      archive: expect.objectContaining({ format: "pmtiles", min_zoom: 7, max_zoom: 14 }),
      layers: expect.arrayContaining([
        expect.objectContaining({
          artifact_id: "power.lines",
          source_layer: "power_lines",
          feature_count: 6_796,
        }),
      ]),
    });
    expect(JSON.stringify(response.body)).not.toContain("way/32043840");
    expect(JSON.stringify(response.body)).not.toContain("osm_tags");
  });

  it("serves PMTiles as a bounded byte range and rejects an unbounded archive request", async () => {
    const archiveUrl = "/api/aoi/rybnik_35km/presentations/power/archive";
    const partial = await request(defaultApp).get(archiveUrl).set("range", "bytes=0-126");

    expect(partial.status).toBe(206);
    expect(partial.headers["accept-ranges"]).toBe("bytes");
    expect(partial.headers["content-range"]).toMatch(/^bytes 0-126\/\d+$/);
    expect(partial.headers.etag).toMatch(/^"[a-f0-9]{64}"$/);
    expect(partial.headers["cache-control"]).toBe("public, max-age=0, must-revalidate");
    expect(partial.headers["content-length"]).toBe("127");

    const unbounded = await request(defaultApp).get(archiveUrl);
    expect(unbounded.status).toBe(416);
    expect(providerErrorSchema.parse(unbounded.body)).toMatchObject({ error: "invalid_request" });
  });

  it("returns 304 for a matching PMTiles ETag without reading a range body", async () => {
    const archiveUrl = "/api/aoi/rybnik_35km/presentations/power/archive";
    const initial = await request(defaultApp).get(archiveUrl).set("range", "bytes=0-126");
    const etag = initial.headers.etag;
    if (!etag) {
      throw new Error("Expected PMTiles response to include an ETag.");
    }

    const cached = await request(defaultApp)
      .get(archiveUrl)
      .set("range", "bytes=0-126")
      .set("if-none-match", etag);

    expect(cached.status).toBe(304);
    expect(cached.headers.etag).toBe(etag);
    expect(cached.headers["cache-control"]).toBe("public, max-age=0, must-revalidate");
    expect(cached.text).toBe("");
  });

  it("serves one validated public map feature without serializing its layer", async () => {
    const response = await request(defaultApp).get(
      "/api/aoi/rybnik_35km/presentations/power/features/node%2F1528794574",
    );

    expect(response.status).toBe(200);
    expect(mapFeatureDetailResponseSchema.parse(response.body)).toMatchObject({
      artifact_id: "power.supports",
      source_id: "node/1528794574",
      feature: {
        properties: { asset_type: "tower", osm_tags: { power: "tower", operator: "Tauron" } },
      },
    });
    expect(JSON.stringify(response.body)).not.toContain("generator:method");

    const malformed = await request(defaultApp).get(
      "/api/aoi/rybnik_35km/presentations/power/features/not-an-osm-id",
    );
    expect(malformed.status).toBe(422);
    const missing = await request(defaultApp).get(
      "/api/aoi/rybnik_35km/presentations/power/features/node%2F1",
    );
    expect(missing.status).toBe(404);

    const plant = await request(defaultApp).get(
      "/api/aoi/rybnik_35km/presentations/power/features/relation%2F12825526",
    );
    expect(plant.status).toBe(200);
    expect(mapFeatureDetailResponseSchema.parse(plant.body)).toMatchObject({
      feature: {
        properties: {
          osm_tags: {
            wikipedia: "pl:Elektrownia Rybnik",
            wikidata: "Q751203",
            website: "https://elrybnik.pgegiek.pl/o-oddziale",
          },
        },
      },
    });
  });

  it("serves only emergency artifacts eligible for public export", async () => {
    const presentations = await request(defaultApp).get("/api/aoi/rybnik_35km/presentations");
    expect(presentations.status).toBe(200);
    expect(presentations.body.presentations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          domain: "emergency",
          layers: expect.arrayContaining([
            expect.objectContaining({ artifact_id: "emergency.hospital" }),
          ]),
        }),
      ]),
    );

    const hospital = await request(defaultApp).get(
      "/api/aoi/rybnik_35km/presentations/emergency/features/way%2F39829907",
    );
    expect(hospital.status).toBe(200);
    expect(mapFeatureDetailResponseSchema.parse(hospital.body)).toMatchObject({
      artifact_id: "emergency.hospital",
      source_id: "way/39829907",
      feature: {
        geometry: { type: "Polygon" },
        properties: {
          source: "OpenStreetMap",
          asset_type: "hospital",
          osm_tags: { amenity: "hospital" },
        },
      },
    });

    const privatePrgEvidence = await request(defaultApp).get(
      "/api/aoi/rybnik_35km/presentations/emergency/features/prg_k02%2F1350186",
    );
    expect(privatePrgEvidence.status).toBe(404);
  });

  it("lists only committed circuits and returns one selected circuit", async () => {
    const available = await request(defaultApp).get(
      "/api/aoi/rybnik_35km/presentations/power/features/way%2F185080408/circuits",
    );
    expect(available.status).toBe(200);
    expect(mapCircuitListResponseSchema.parse(available.body)).toMatchObject({
      state: "available",
      circuits: [
        expect.objectContaining({
          relation_id: "relation/19511895",
          aoi_coverage: "bounded_source_snapshot",
        }),
      ],
    });
    const detail = await request(defaultApp).get(
      "/api/aoi/rybnik_35km/presentations/power/circuits/relation%2F19511895",
    );
    expect(detail.status).toBe(200);
    expect(mapCircuitDetailResponseSchema.parse(detail.body)).toMatchObject({
      circuit: { relation_id: "relation/19511895" },
    });
    expect(Object.keys((detail.body.circuit as { tags: object }).tags)).not.toContain("flow");
    const absent = await request(defaultApp).get(
      "/api/aoi/rybnik_35km/presentations/power/features/node%2F1758555079/circuits",
    );
    expect(mapCircuitListResponseSchema.parse(absent.body)).toMatchObject({
      state: "not_applicable",
      circuits: [],
    });
  });
});
