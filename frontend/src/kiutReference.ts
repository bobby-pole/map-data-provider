export const KIUT_WMS_URL =
  "https://integracja.gugik.gov.pl/cgi-bin/KrajowaIntegracjaUzbrojeniaTerenu";

export const kiutReferenceLayers = [
  { id: "power", label: "KIUT electricity", wmsLayer: "przewod_elektroenergetyczny" },
  { id: "water", label: "KIUT water", wmsLayer: "przewod_wodociagowy" },
  { id: "gas", label: "KIUT gas", wmsLayer: "przewod_gazowy" },
  { id: "sewer", label: "KIUT sewer", wmsLayer: "przewod_kanalizacyjny" },
  { id: "telecom", label: "KIUT telecom", wmsLayer: "przewod_telekomunikacyjny" },
  { id: "district_heating", label: "KIUT district heating", wmsLayer: "przewod_cieplowniczy" },
] as const;

export type KiutReferenceLayer = (typeof kiutReferenceLayers)[number];
export const KIUT_MIN_ZOOM = 19; // At the preview latitude this is finer than the published 1:1000 maximum denominator.
export const KIUT_MAX_ZOOM = 20;
