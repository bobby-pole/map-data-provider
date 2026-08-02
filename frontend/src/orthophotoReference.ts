export const ORTHOPHOTO_WMS_URL = "https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/HighResolution";
export const orthophotoReference = {
  id: "geoportal-orthophoto",
  label: "Geoportal orthophoto",
  wmsLayer: "Raster",
  sourceDate: "Not published in the WMS capabilities snapshot",
  resolution: "Not published in the WMS capabilities snapshot",
  attribution: "GUGiK, Geoportal orthophoto",
  limitation: "Reference imagery only; it is not analytical GeoJSON or a statement of current operational conditions.",
} as const;
