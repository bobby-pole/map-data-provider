import { describe, expect, it } from "vitest";

import { isLinePresentationLayer, openStreetMapBasemap, presentationColor, referenceRasterInsertionPoint, supportStyle, voltageLineColor } from "./mapStyle";

describe("MapLibre presentation style policy", () => {
  it("renders line source layers as lines and asset layers as inspectable points", () => {
    expect(isLinePresentationLayer("power_lines")).toBe(true);
    expect(isLinePresentationLayer("transport.roads")).toBe(true);
    expect(isLinePresentationLayer("transport.railways")).toBe(true);
    expect(isLinePresentationLayer("power_assets")).toBe(false);
    expect(isLinePresentationLayer("transport.stations")).toBe(false);
  });

  it("uses a deterministic, bounded palette for manifest layers", () => {
    expect(presentationColor(0)).toBe("#f59e0b");
    expect(presentationColor(4)).toBe("#f59e0b");
  });

  it("uses the standard OSM raster endpoint only as an attributed online basemap", () => {
    expect(openStreetMapBasemap.tileUrlTemplate).toBe("https://tile.openstreetmap.org/{z}/{x}/{y}.png");
    expect(openStreetMapBasemap.attribution).toContain("OpenStreetMap contributors");
  });

  it("keeps voltage buckets, road classes and source support classes visually distinct", () => {
    expect(voltageLineColor).toEqual(expect.arrayContaining(["high_110", "#dc2626", "high_220", "#d946ef", "high_400", "#a855f7"]));
    expect(supportStyle("tower")).toEqual({ color: "#f97316", radius: 5 });
    expect(supportStyle("pole")).toEqual({ color: "#cbd5e1", radius: 3 });
  });

  it("inserts reference rasters below analytical provider vectors", () => {
    expect(referenceRasterInsertionPoint(["background", "basemap:openstreetmap", "provider:power-lines", "provider:power-assets"])).toBe("provider:power-lines");
    expect(referenceRasterInsertionPoint(["background", "basemap:openstreetmap"])).toBeUndefined();
  });
});
