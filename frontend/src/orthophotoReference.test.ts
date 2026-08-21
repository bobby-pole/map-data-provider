import { describe, expect, it } from "vitest";

import { ORTHOPHOTO_WMS_URL, orthophotoReference } from "./orthophotoReference";

describe("orthophoto reference overlay allow-list", () => {
  it("uses the fixed official WMS endpoint, Raster layer and explicit metadata limits", () => {
    expect(ORTHOPHOTO_WMS_URL).toBe(
      "https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/HighResolution",
    );
    expect(orthophotoReference.wmsLayer).toBe("Raster");
    expect(orthophotoReference.sourceDate).toMatch(/Not published/);
    expect(orthophotoReference.resolution).toMatch(/Not published/);
  });
});
