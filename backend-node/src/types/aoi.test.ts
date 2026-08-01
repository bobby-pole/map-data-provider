import { describe, expect, it } from "vitest";

import { aoiInputSchema, resolvedAoiSchema } from "./provider.js";

describe("provider_aoi/v1 contracts", () => {
  it("accepts bounded circle and approved administrative-reference request shapes", () => {
    expect(aoiInputSchema.parse({ type: "circle", longitude: 18.546285, latitude: 50.102174, radius_m: 60_000 })).toMatchObject({ type: "circle" });
    expect(aoiInputSchema.parse({ type: "administrative_reference", reference_id: "prg_gmina_rybnik" })).toMatchObject({ type: "administrative_reference" });
  });

  it("rejects unsafe circles and uncontracted geometry fields", () => {
    expect(() => aoiInputSchema.parse({ type: "circle", longitude: 18.5, latitude: 50.1, radius_m: 0 })).toThrow();
    expect(() => aoiInputSchema.parse({ type: "circle", longitude: 18.5, latitude: 50.1, radius_m: 1_000, cache_key: "../escape" })).toThrow();
  });

  it("validates resolved AOI metadata without accepting an unsafe cache key", () => {
    const resolved = {
      aoi_contract_version: "provider_aoi/v1", aoi_id: "aoi_1234", cache_key: "rybnik_60km",
      geometry: { type: "Polygon", coordinates: [[[18.49, 50.06], [18.64, 50.06], [18.49, 50.06]]] },
      geometry_crs: "EPSG:4326",
      input_type: "administrative_reference", source_crs: "EPSG:4326",
      boundary_provenance: { kind: "prg_reference", reference_id: "prg_gmina_rybnik" },
      constraints: { max_area_sq_m: 31_415_926_535.89793, min_radius_m: 100, max_radius_m: 100_000 }, aliases: ["rybnik_60km"],
    };
    expect(resolvedAoiSchema.parse(resolved).cache_key).toBe("rybnik_60km");
    expect(() => resolvedAoiSchema.parse({ ...resolved, cache_key: "../escape" })).toThrow();
  });
});
