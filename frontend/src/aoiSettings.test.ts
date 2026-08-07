import { describe, expect, it } from "vitest";

import { buildRuntimeRequest, providerResponseMessage, runtimeRequestError } from "./aoiSettings";

describe("AOI settings request state", () => {
  it("normalizes an administrative union and category order before submission", () => {
    expect(buildRuntimeRequest("administrative_selection", { longitude: "", latitude: "", radius: "", unitIds: ["county_rybnicki", "county_rybnik_city", "county_rybnicki"] }, ["water", "power", "water"])).toEqual({
      aoi: { type: "administrative_selection", unit_ids: ["county_rybnicki", "county_rybnik_city"] }, profiles: ["power", "water"],
    });
  });

  it("builds a point/radius request and rejects incomplete settings", () => {
    expect(buildRuntimeRequest("point_radius", { longitude: "18.5", latitude: "50.1", radius: "1000", unitIds: [] }, ["power"])).toEqual({ aoi: { type: "point_radius", longitude: 18.5, latitude: 50.1, radius_m: 1000 }, profiles: ["power"] });
    expect(() => buildRuntimeRequest("administrative_selection", { longitude: "", latitude: "", radius: "", unitIds: [] }, ["power"])).toThrow();
  });

  it("explains that a failed acquisition preserves the existing map", async () => {
    const response = new Response(JSON.stringify({ error: "worker_failed", message: "worker_failed: Overpass timed out." }), { status: 502 });
    await expect(runtimeRequestError(response)).resolves.toBe("No new AOI snapshot was published; the existing map was left unchanged. worker_failed: Overpass timed out.");
  });

  it("uses a clear fallback when an API error has no structured message", async () => {
    await expect(providerResponseMessage(new Response("gateway failure", { status: 502 }), "Administrative catalogue could not be read (HTTP 502).")).resolves.toBe("Administrative catalogue could not be read (HTTP 502).");
  });
});
