import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../app.js";
import { seedCompactRybnikCache, writeFixtureDomainPack } from "../test/fixtures.js";
import {
  aoiAvailabilityResponseSchema,
  domainPackListResponseSchema,
  domainPackReadResponseSchema,
  preparedSnapshotCatalogueResponseSchema,
  providerErrorSchema,
} from "../types/provider.js";
import { canonicalJson, sha256Hex } from "../utils/canonicalJson.js";

describe("AOI prepared snapshot gating, provenance, and corrupt-snapshot isolation", () => {
  let temporaryDirectory: string;

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "mdq-snapshot-routes-"));
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it("serves completed domain packs from a published partial snapshot", async () => {
    const { app } = await writeFixtureDomainPack(temporaryDirectory, { snapshotState: "partial" });
    const response = await request(app).get("/api/aoi/fixture_aoi/domain-packs");
    expect(response.status).toBe(200);
    expect(domainPackListResponseSchema.parse(response.body).domain_packs).toEqual([
      expect.objectContaining({ aoi_id: "fixture_aoi", domain: "water" }),
    ]);
  });

  it("rejects an export that is not tied to a checksum-validated prepared snapshot", async () => {
    const app = createApp({ providerDataPaths: { cacheRoot: temporaryDirectory } });
    const response = await request(app).get("/api/aoi/unpublished_aoi/export?domains=power");
    expect(response.status).toBe(404);
    expect(providerErrorSchema.parse(response.body)).toMatchObject({ error: "not_found" });
  });

  it("does not serve a PMTiles presentation that is outside a ready prepared snapshot", async () => {
    const app = createApp({ providerDataPaths: { cacheRoot: temporaryDirectory } });
    const response = await request(app)
      .get("/api/aoi/unpublished_aoi/presentations/power/archive")
      .set("range", "bytes=0-126");
    expect(response.status).toBe(404);
    expect(providerErrorSchema.parse(response.body)).toMatchObject({ error: "not_found" });
  });

  it("discovers a fixture domain solely from its v2 manifest", async () => {
    const fixture = await writeFixtureDomainPack(temporaryDirectory);
    const listed = await request(fixture.app).get(`/api/aoi/${fixture.aoiId}/domain-packs`);
    expect(listed.status).toBe(200);
    expect(domainPackListResponseSchema.parse(listed.body).domain_packs).toEqual([
      expect.objectContaining({
        domain: fixture.domain,
        layers: [
          expect.objectContaining({ artifact: expect.objectContaining({ id: "water.main" }) }),
        ],
      }),
    ]);
    const read = await request(fixture.app).get(
      `/api/aoi/${fixture.aoiId}/domain-packs/${fixture.domain}`,
    );
    expect(read.status).toBe(200);
    expect(
      domainPackReadResponseSchema.parse(read.body).layers[0]?.layer.metadata.limitations,
    ).toContain("Fixture limitations are visible in the preview.");
  });

  it("rejects a public analytical artifact whose provenance is reference-only", async () => {
    const fixture = await writeFixtureDomainPack(temporaryDirectory, {
      sourceId: "kiut_gesut_wms",
    });
    const response = await request(fixture.app).get(
      `/api/aoi/${fixture.aoiId}/domain-packs/${fixture.domain}`,
    );
    expect(response.status).toBe(404);
    expect(providerErrorSchema.parse(response.body).message).toMatch(
      /not eligible for public export/i,
    );
    expect(response.body.layers).toBeUndefined();
  });

  it("isolates a checksum-mismatched snapshot in /snapshots and /availability while rejecting direct reads", async () => {
    await seedCompactRybnikCache(temporaryDirectory);
    const corruptAoiId = "aoi_40357f1be7570f5d";
    const corruptPackDir = path.join(temporaryDirectory, corruptAoiId, "power", "domain-pack-v2");
    await mkdir(corruptPackDir, { recursive: true });
    await writeFile(path.join(corruptPackDir, "manifest.json"), '{"changed":true}');

    const unsignedCorrupt = {
      snapshot_version: "provider_prepared_snapshot/v1",
      snapshot_id: corruptAoiId,
      aoi_id: corruptAoiId,
      version: "runtime-2026-08-31T10:00:00Z",
      state: "ready",
      published_at: "2026-08-31T10:00:00Z",
      source_observed_at: "2026-08-31T10:00:00Z",
      pipeline_version: "fixture/v1",
      coverage: {
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [18.4, 50.0],
              [18.6, 50.0],
              [18.6, 50.2],
              [18.4, 50.0],
            ],
          ],
        },
        geometry_crs: "EPSG:4326",
        input_type: "circle",
        source_label: "Resolved bounded point/radius AOI",
        limitations: ["Fixture source-dated evidence."],
      },
      domain_outcomes: [
        {
          domain: "power",
          status: "ready",
          detail: "Fixture domain",
          manifest_sha256: "0".repeat(64),
          readiness: "ready",
          limitations: [],
        },
      ],
    };
    await writeFile(
      path.join(temporaryDirectory, corruptAoiId, "snapshot_manifest.json"),
      JSON.stringify({
        ...unsignedCorrupt,
        checksum: sha256Hex(canonicalJson(unsignedCorrupt)),
      }),
    );

    const isolatedApp = createApp({
      providerDataPaths: { cacheRoot: temporaryDirectory },
      runtimePolicy: { mode: "local_bounded" },
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const catalogue = await request(isolatedApp).get("/api/aoi/snapshots");
      expect(catalogue.status).toBe(200);
      const parsedCatalogue = preparedSnapshotCatalogueResponseSchema.parse(catalogue.body);
      expect(parsedCatalogue.snapshots.map((item) => item.aoi_id)).toEqual(["rybnik_35km"]);

      const availability = await request(isolatedApp)
        .post("/api/aoi/availability")
        .send({
          aoi: {
            type: "point_radius",
            longitude: 18.546,
            latitude: 50.097,
            radius_m: 10_000,
          },
        });
      expect(availability.status).toBe(200);
      expect(aoiAvailabilityResponseSchema.parse(availability.body)).toMatchObject({
        state: "partial_coverage",
        snapshot_ids: ["rybnik_35km"],
      });

      const directCorrupt = await request(isolatedApp).get(
        `/api/aoi/${corruptAoiId}/presentations`,
      );
      expect(directCorrupt.status).toBe(422);
      expect(providerErrorSchema.parse(directCorrupt.body)).toMatchObject({
        error: "invalid_request",
        message: `Prepared snapshot '${corruptAoiId}' has a checksum mismatch for 'power'.`,
      });

      const directHealthy = await request(isolatedApp).get("/api/aoi/rybnik_35km/presentations");
      expect(directHealthy.status).toBe(200);
    } finally {
      warnSpy.mockRestore();
    }
  });
});
