export const ORTHOPHOTO_WMS_URL =
  "https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMS/HighResolution";

export const ORTHOPHOTO_WMTS_URL =
  "https://mapy.geoportal.gov.pl/wss/service/PZGIK/ORTO/WMTS/StandardResolution?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=ORTOFOTOMAPA&STYLE=default&FORMAT=image/jpeg&TILEMATRIXSET=EPSG:3857&TILEMATRIX=EPSG:3857:{z}&TILEROW={y}&TILECOL={x}";

export const ORTHOPHOTO_MIN_ZOOM = 0;
export const ORTHOPHOTO_MAX_ZOOM = 19;

export const orthophotoReference = {
  id: "geoportal-orthophoto",
  label: "Geoportal orthophoto",
  wmsLayer: "Raster",
  wmtsLayer: "ORTOFOTOMAPA",
  sourceDate: "Not published in the WMS capabilities snapshot",
  resolution: "Not published in the WMS capabilities snapshot",
  attribution: "GUGiK, Geoportal orthophoto",
  limitation:
    "Reference imagery only; it is not analytical GeoJSON or a statement of current operational conditions.",
} as const;
