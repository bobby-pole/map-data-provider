import type { Geometry } from "geojson";
import type maplibregl from "maplibre-gl";
import { type MapGeoJSONFeature } from "maplibre-gl";

import { referenceRasterInsertionPoint } from "../../mapStyle";
import { mapSymbolDataUrl, mapSymbolImageId, mapSymbolKinds } from "../../mapSymbols";
import { type PreviewLayer, previewLayerKey } from "../../previewCatalog";
import type { ProviderFeature } from "../../types/api";
import {
  type AoiOutlineStyle,
  POPUP_FIELD_NAMES,
  PROVIDER_PREFIX,
  REFERENCE_PREFIX,
} from "./constants";

export function providerLayerId(layer: PreviewLayer): string {
  return `${PROVIDER_PREFIX}${previewLayerKey(layer)}`;
}

export function providerInteractiveLayerIds(layer: PreviewLayer): string[] {
  const id = providerLayerId(layer);
  return [id, `${id}-medium`, `${id}-low`, `${id}-fill`, `${id}-outline`];
}

export function providerSourceId(archiveUrl: string): string {
  return `${PROVIDER_PREFIX}archive:${archiveUrl.replace(/[^a-z0-9]/gi, "_")}`;
}

export function firstProviderInteractiveLayerId(map: maplibregl.Map): string | undefined {
  const style = map.getStyle();
  return style?.layers?.find(
    (l) =>
      l.id.startsWith(PROVIDER_PREFIX) && !l.id.endsWith("-fill") && !l.id.endsWith("-outline"),
  )?.id;
}

export function geometryBounds(geometry: Geometry): [number, number, number, number] | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  const include = (coordinates: unknown): void => {
    if (!Array.isArray(coordinates)) {
      return;
    }
    if (typeof coordinates[0] === "number" && typeof coordinates[1] === "number") {
      const longitude = coordinates[0];
      const latitude = coordinates[1];
      west = Math.min(west, longitude);
      south = Math.min(south, latitude);
      east = Math.max(east, longitude);
      north = Math.max(north, latitude);
      return;
    }
    coordinates.forEach(include);
  };
  if (geometry.type === "GeometryCollection") {
    geometry.geometries.forEach((item) =>
      include(item.type === "GeometryCollection" ? item.geometries : item.coordinates),
    );
  } else {
    include(geometry.coordinates);
  }
  return Number.isFinite(west) ? [west, south, east, north] : null;
}

export function wmsTileUrl(endpoint: string, wmsLayer: string, format: string): string {
  const parameters = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.3.0",
    REQUEST: "GetMap",
    LAYERS: wmsLayer,
    STYLES: "",
    FORMAT: format,
    TRANSPARENT: "TRUE",
    CRS: "EPSG:3857",
    WIDTH: "256",
    HEIGHT: "256",
    BBOX: "{bbox-epsg-3857}",
  });
  return `${endpoint}?${parameters.toString().replace("%7Bbbox-epsg-3857%7D", "{bbox-epsg-3857}")}`;
}

export async function registerMapSymbols(map: maplibregl.Map): Promise<void> {
  await Promise.all(
    mapSymbolKinds().map(async (kind) => {
      const imageId = mapSymbolImageId(kind);
      if (map.hasImage(imageId)) {
        return;
      }
      await new Promise<void>((resolve) => {
        const image = new Image(48, 48);
        image.onload = () => {
          if (!map.hasImage(imageId)) {
            map.addImage(imageId, image, { pixelRatio: 2 });
          }
          resolve();
        };
        image.onerror = () => resolve();
        image.src = mapSymbolDataUrl(kind);
      });
    }),
  );
}

export function replaceAoiOutline(
  map: maplibregl.Map,
  style: AoiOutlineStyle,
  geometry: Geometry | null,
): void {
  if (map.getLayer(style.line)) {
    map.removeLayer(style.line);
  }
  if (map.getLayer(style.fill)) {
    map.removeLayer(style.fill);
  }
  if (map.getSource(style.source)) {
    map.removeSource(style.source);
  }
  if (!geometry || !["Polygon", "MultiPolygon"].includes(geometry.type)) {
    return;
  }
  map.addSource(style.source, {
    type: "geojson",
    data: { type: "Feature", properties: {}, geometry },
  });
  map.addLayer({
    id: style.fill,
    type: "fill",
    source: style.source,
    paint: { "fill-color": style.color, "fill-opacity": style.fillOpacity },
  });
  map.addLayer({
    id: style.line,
    type: "line",
    source: style.source,
    paint: { "line-color": style.color, "line-width": 2.5, "line-dasharray": style.dash },
  });
}

export function popupAttributeEntries(
  properties: ProviderFeature["properties"],
): Array<[string, string]> {
  const tags = {
    ...asStringRecord(properties.osm_tags),
    ...asStringRecord(properties.source_attributes),
  };
  return POPUP_FIELD_NAMES.filter(
    (name) => tags[name] || (name === "road_class" && typeof properties.road_class === "string"),
  ).map((name) => [name, String(tags[name] ?? properties[name] ?? "")] as [string, string]);
}

export function formatVoltage(value: string | undefined): string {
  if (!value) {
    return "unknown";
  }
  const values = value
    .split(";")
    .map((part) => Number(part.trim()))
    .filter(Number.isFinite);
  return values.length ? `${values.map((volts) => volts / 1000).join("/")} kV` : value;
}

export function asStringRecord(value: unknown): Record<string, string> {
  return value && typeof value === "object"
    ? Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      )
    : {};
}

export function isValidHttpUrl(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function parseWikipediaUrl(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const [language, ...title] = value.split(":");
  if (!/^[a-z-]{2,12}$/i.test(language) || !title.join(":")) {
    return null;
  }
  return `https://${language}.wikipedia.org/wiki/${encodeURIComponent(title.join(":"))}`;
}

export function asProviderFeature(feature: MapGeoJSONFeature): ProviderFeature {
  return {
    type: "Feature",
    properties: feature.properties ?? {},
    geometry: feature.geometry,
  };
}

export function addRasterTileReference(
  map: maplibregl.Map,
  key: string,
  tileUrl: string,
  attribution: string,
  minzoom: number,
  maxzoom: number,
): void {
  const sourceId = `${REFERENCE_PREFIX}${key}`;
  map.addSource(sourceId, {
    type: "raster",
    tiles: [tileUrl],
    tileSize: 256,
    attribution,
    minzoom,
    maxzoom,
  });
  // Reference imagery stays below public analytical vectors. KIUT remains above
  // orthophoto because each subsequent raster is inserted immediately before
  // the first provider layer.
  map.addLayer(
    {
      id: sourceId,
      type: "raster",
      source: sourceId,
      minzoom,
      paint: { "raster-opacity": key === "orthophoto" ? 0.8 : 0.85 },
    },
    referenceRasterInsertionPoint(map.getStyle().layers?.map((layer) => layer.id) ?? []),
  );
}

export function removePrefixedLayersAndSources(map: maplibregl.Map, prefix: string): void {
  map
    .getStyle()
    .layers?.filter((layer) => layer.id.startsWith(prefix))
    .forEach((layer) => map.removeLayer(layer.id));
  Object.keys(map.getStyle().sources)
    .filter((sourceId) => sourceId.startsWith(prefix))
    .forEach((sourceId) => map.removeSource(sourceId));
}
