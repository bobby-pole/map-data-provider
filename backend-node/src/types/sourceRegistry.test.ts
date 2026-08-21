import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  domainPackV2Schema,
  isPublicExportEligible,
  sourceRegistryV2Schema,
  validateOrderedSourceProvenance,
} from "./provider.js";

const fixtureRoot = new URL("../../../backend/data/fixtures/source_registry/", import.meta.url);

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(fileURLToPath(new URL(name, fixtureRoot)), "utf8")) as unknown;
}

describe("source_registry/v2 contract", () => {
  it("accepts the shared valid fixture and preserves source-family dimensions", async () => {
    const registry = sourceRegistryV2Schema.parse(await fixture("registry-v2.json"));
    const sources = new Map(registry.sources.map((source) => [source.id, source]));

    expect(sources.get("openstreetmap")).toMatchObject({
      data_kind: "vector",
      format: "osm_query",
      authority: "community",
      usage_role: "analytical",
    });
    expect(sources.get("prg_wfs")).toMatchObject({
      data_kind: "vector",
      format: "wfs_gml",
      authority: "official",
      qualification: "pending_qualification",
    });
    expect(sources.get("bdot10k")).toMatchObject({ format: "gpkg_geoparquet" });
    expect(sources.get("kiut_gesut_wms")).toMatchObject({
      data_kind: "rendered_imagery",
      format: "wms",
      usage_role: "reference",
    });
    expect(sources.get("geoportal_orthophoto")).toMatchObject({
      data_kind: "rendered_imagery",
      format: "wms",
    });
    expect(sources.get("nmt_nmpt")).toMatchObject({
      data_kind: "raster",
      format: "geotiff_ascii_grid",
    });
    expect(isPublicExportEligible(sources.get("openstreetmap")!)).toBe(true);
    expect(isPublicExportEligible(sources.get("kiut_gesut_wms")!)).toBe(false);
  });

  it.each(["invalid-incomplete-v2.json", "invalid-contradictory-v2.json"])(
    "rejects shared invalid fixture %s",
    async (name) => {
      expect(sourceRegistryV2Schema.safeParse(await fixture(name)).success).toBe(false);
    },
  );

  it("rejects an extra source field like the Python validator", async () => {
    const registry = (await fixture("registry-v2.json")) as {
      sources: Array<Record<string, unknown>>;
    };
    registry.sources[0]!.unexpected = true;
    expect(sourceRegistryV2Schema.safeParse(registry).success).toBe(false);
  });

  it("accepts free registration as no-cost access metadata", async () => {
    const registry = (await fixture("registry-v2.json")) as {
      sources: Array<Record<string, unknown>>;
    };
    registry.sources[0]!.access_method = "free_registration";
    expect(sourceRegistryV2Schema.safeParse(registry).success).toBe(true);
  });

  it("rejects restricted access claiming to be qualified free", async () => {
    const registry = (await fixture("registry-v2.json")) as {
      sources: Array<Record<string, unknown>>;
    };
    registry.sources[0]!.access_method = "paid";
    expect(sourceRegistryV2Schema.safeParse(registry).success).toBe(false);
  });

  it("enforces ordered provenance and public-export eligibility", async () => {
    const registry = sourceRegistryV2Schema.parse(await fixture("registry-v2.json"));
    expect(() =>
      validateOrderedSourceProvenance(
        [{ source_id: "openstreetmap", contribution_role: "primary" }],
        registry,
        true,
      ),
    ).not.toThrow();
    expect(() =>
      validateOrderedSourceProvenance(
        [{ source_id: "kiut_gesut_wms", contribution_role: "validation_reference" }],
        registry,
        true,
      ),
    ).toThrow(/not eligible/);
    expect(() =>
      validateOrderedSourceProvenance(
        [
          { source_id: "openstreetmap", contribution_role: "primary" },
          { source_id: "openstreetmap", contribution_role: "supplementary" },
        ],
        registry,
        false,
      ),
    ).toThrow(/must be unique/);
  });

  it("validates role-named domain-pack artifacts without changing v1 route schemas", () => {
    const pack = domainPackV2Schema.parse({
      domain_pack_version: "provider_domain_pack/v2",
      aoi_id: "fixture_aoi",
      domain: "power",
      source_provenance: [{ source_id: "openstreetmap", contribution_role: "primary" }],
      artifacts: [
        {
          id: "power.lines",
          kind: "processed_vector",
          format: "geojson",
          path: "layers/power.lines.geojson",
          sha256: "a".repeat(64),
          feature_count: 1,
          source_provenance: [{ source_id: "openstreetmap", contribution_role: "primary" }],
          public_export: true,
        },
      ],
      validation: { path: "validation/report.json" },
      readiness: { path: "readiness/report.json" },
    });
    expect(pack.artifacts[0]?.id).toBe("power.lines");
  });
});
