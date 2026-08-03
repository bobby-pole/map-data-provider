import { describe, expect, it } from "vitest";

import { isLinePresentationLayer, openStreetMapBasemap, presentationColor } from "./mapStyle";

describe("MapLibre presentation style policy", () => {
  it("renders line source layers as lines and asset layers as inspectable points", () => {
    expect(isLinePresentationLayer("power_lines")).toBe(true);
    expect(isLinePresentationLayer("power_assets")).toBe(false);
  });

  it("uses a deterministic, bounded palette for manifest layers", () => {
    expect(presentationColor(0)).toBe("#f59e0b");
    expect(presentationColor(4)).toBe("#f59e0b");
  });

  it("uses the standard OSM raster endpoint only as an attributed online basemap", () => {
    expect(openStreetMapBasemap.tileUrlTemplate).toBe("https://tile.openstreetmap.org/{z}/{x}/{y}.png");
    expect(openStreetMapBasemap.attribution).toContain("OpenStreetMap contributors");
  });
});
