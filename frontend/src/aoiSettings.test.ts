import { describe, expect, it } from "vitest";

import { DEFAULT_AOI_OUTLINE, administrativeSelectionRoots, administrativeSelectionZoom, buildRuntimeRequest, displayedAoiOutlines, pointRadiusOutline, providerResponseMessage, runtimeRequestError } from "./aoiSettings";

describe("AOI settings request state", () => {
  it("normalizes an administrative union and category order before submission", () => {
    expect(buildRuntimeRequest("administrative_selection", { longitude: "", latitude: "", radius: "", unitIds: ["county_rybnicki", "county_rybnik_city", "county_rybnicki"] }, ["water", "power", "water"])).toEqual({
      aoi: { type: "administrative_selection", unit_ids: ["county_rybnicki", "county_rybnik_city"] }, profiles: ["power", "water"],
    });
  });

  it("finds a single province root for county/gmina selections", () => {
    const units = [
      { id: "voivodeship_24", kind: "voivodeship", name: "śląskie", prg_id: "24", parent_id: null },
      { id: "county_2473", kind: "county", name: "Rybnik", prg_id: "2473", parent_id: "voivodeship_24" },
      { id: "gmina_2473011", kind: "gmina", name: "Rybnik", prg_id: "2473011", parent_id: "county_2473" },
      { id: "voivodeship_14", kind: "voivodeship", name: "mazowieckie", prg_id: "14", parent_id: null },
    ] as const;
    expect(administrativeSelectionRoots(["county_2473", "gmina_2473011"], [...units])).toEqual(["voivodeship_24"]);
    expect(administrativeSelectionRoots(["gmina_2473011", "voivodeship_14"], [...units])).toEqual(["voivodeship_14", "voivodeship_24"]);
    expect(administrativeSelectionZoom(["voivodeship_24"], [...units])).toBe(7.5);
    expect(administrativeSelectionZoom(["county_2473"], [...units])).toBe(9);
    expect(administrativeSelectionZoom(["gmina_2473011"], [...units])).toBe(9);
  });

  it("builds a point/radius request and rejects incomplete settings", () => {
    expect(buildRuntimeRequest("point_radius", { longitude: "18.5", latitude: "50.1", radius: "1000", unitIds: [] }, ["power"])).toEqual({ aoi: { type: "point_radius", longitude: 18.5, latitude: 50.1, radius_m: 1000 }, profiles: ["power"] });
    expect(buildRuntimeRequest("point_radius", { longitude: " 18,546 ", latitude: " 50,102 ", radius: " 20000 ", unitIds: [] }, ["power"])).toEqual({ aoi: { type: "point_radius", longitude: 18.546, latitude: 50.102, radius_m: 20000 }, profiles: ["power"] });
    expect(() => buildRuntimeRequest("administrative_selection", { longitude: "", latitude: "", radius: "", unitIds: [] }, ["power"])).toThrow();
  });

  it("explains that a failed acquisition preserves the existing map", async () => {
    const response = new Response(JSON.stringify({ error: "worker_failed", message: "worker_failed: Overpass timed out." }), { status: 502 });
    await expect(runtimeRequestError(response)).resolves.toBe("No new AOI snapshot was published; the existing map was left unchanged. worker_failed: Overpass timed out.");
  });

  it("uses a clear fallback when an API error has no structured message", async () => {
    await expect(providerResponseMessage(new Response("gateway failure", { status: 502 }), "Administrative catalogue could not be read (HTTP 502).")).resolves.toBe("Administrative catalogue could not be read (HTTP 502).");
  });

  it("renders a closed point/radius outline for a map-selected AOI", () => {
    const outline = pointRadiusOutline(18.546285, 50.102174, 20_000);
    expect(outline?.type).toBe("Polygon");
    expect(outline?.coordinates[0]).toHaveLength(65);
    expect(outline?.coordinates[0]?.[0]).toEqual(outline?.coordinates[0]?.at(-1));
    expect(pointRadiusOutline(Number.NaN, 50.1, 1_000)).toBeNull();
  });

  it("keeps a new PRG draft boundary visible over the prepared AOI until selection is cleared", () => {
    const prepared = pointRadiusOutline(18.5, 50.1, 20_000);
    const draft = pointRadiusOutline(18.7, 50.2, 1_000);

    expect(displayedAoiOutlines(draft, prepared)).toEqual({ draft, prepared });
    expect(displayedAoiOutlines(null, prepared)).toEqual({ draft: null, prepared });
  });

  it("provides a default 35km outline for Rybnik snapshot", () => {
    expect(DEFAULT_AOI_OUTLINE?.type).toBe("Polygon");
    expect(DEFAULT_AOI_OUTLINE?.coordinates[0]).toHaveLength(65);
    expect(DEFAULT_AOI_OUTLINE?.coordinates[0]?.[0]).toEqual(DEFAULT_AOI_OUTLINE?.coordinates[0]?.at(-1));
  });
});
