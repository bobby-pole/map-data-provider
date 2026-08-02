import { describe, expect, it } from "vitest";
import { KIUT_MAX_ZOOM, KIUT_MIN_ZOOM, KIUT_WMS_URL, kiutReferenceLayers } from "./kiutReference";

describe("KIUT reference overlay allow-list", () => {
  it("uses only the fixed GUGiK endpoint and verified utility layers", () => {
    expect(KIUT_WMS_URL).toBe("https://integracja.gugik.gov.pl/cgi-bin/KrajowaIntegracjaUzbrojeniaTerenu");
    expect(kiutReferenceLayers.map((layer) => layer.wmsLayer)).toEqual([
      "przewod_elektroenergetyczny", "przewod_wodociagowy", "przewod_gazowy", "przewod_kanalizacyjny", "przewod_telekomunikacyjny", "przewod_cieplowniczy",
    ]);
    expect(KIUT_MIN_ZOOM).toBe(19);
    expect(KIUT_MAX_ZOOM).toBe(20);
  });
});
