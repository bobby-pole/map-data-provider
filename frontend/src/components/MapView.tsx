import "maplibre-gl/dist/maplibre-gl.css";

import type { Geometry } from "geojson";
import maplibregl, { type MapGeoJSONFeature } from "maplibre-gl";
import { Protocol } from "pmtiles";
import { Fragment, useEffect, useRef, useState } from "react";

import type { SelectedProviderFeature } from "../inspection";
import {
  KIUT_MAX_ZOOM,
  KIUT_MIN_ZOOM,
  KIUT_WMS_URL,
  type KiutReferenceLayer,
} from "../kiutReference";
import {
  baseMapRasterPaint,
  isLinePresentationLayer,
  openStreetMapBasemap,
  powerVoltageLabelMinZoom,
  referenceRasterInsertionPoint,
  roadLineColor,
  type VisualBasemapMode,
  voltageLineColor,
} from "../mapStyle";
import {
  mapSymbolDataUrl,
  mapSymbolImageId,
  mapSymbolKinds,
  pointSymbolExpression,
  pointSymbolSize,
} from "../mapSymbols";
import { ORTHOPHOTO_WMS_URL, orthophotoReference } from "../orthophotoReference";
import { isPopupOnlyNetworkArtifact, layerPresentationSemantic } from "../presentationSemantics";
import {
  popupDetails,
  type PreviewLayer,
  previewLayerKey,
  type TransportRoadClass,
} from "../previewCatalog";
import type {
  MapCircuit,
  MapCircuitDetail,
  MapCircuitList,
  MapCircuitMember,
  MapFeatureDetail,
  ProviderFeature,
} from "../types/api";
import { CloseButton } from "./CloseButton";

const pmtilesProtocol = new Protocol();
maplibregl.addProtocol("pmtiles", pmtilesProtocol.tile);

const PROVIDER_PREFIX = "provider:";
const REFERENCE_PREFIX = "reference:";
const BASEMAP_SOURCE_ID = "basemap:openstreetmap";
const CIRCUIT_SOURCE_ID = "circuit:selected";
const CIRCUIT_GLOW_OUTER_ID = "circuit:selected-glow-outer";
const CIRCUIT_LINE_ID = "circuit:selected-line";
const CIRCUIT_ENDPOINT_ID = "circuit:selected-endpoints";
const CIRCUIT_MEMBER_SOURCE_ID = "circuit:selected-member";
const CIRCUIT_MEMBER_GLOW_OUTER_ID = "circuit:selected-member-glow-outer";
const CIRCUIT_MEMBER_HALO_ID = "circuit:selected-member-halo";
const CIRCUIT_MEMBER_LINE_ID = "circuit:selected-member-line";
const CIRCUIT_MEMBER_ENDPOINT_ID = "circuit:selected-member-endpoints";
const SELECTED_FEATURE_SOURCE_ID = "selected:feature";
const SELECTED_FEATURE_GLOW_OUTER_ID = "selected:feature-glow-outer";
const SELECTED_FEATURE_LINE_ID = "selected:feature-line";
const SELECTED_FEATURE_ENDPOINT_ID = "selected:feature-endpoints";
const DRAFT_AOI_OUTLINE = {
  source: "aoi:draft",
  fill: "aoi:draft-fill",
  line: "aoi:draft-line",
  color: "#38bdf8",
  fillOpacity: 0.11,
  dash: [2, 1],
};
const PREPARED_AOI_OUTLINE = {
  source: "aoi:prepared",
  fill: "aoi:prepared-fill",
  line: "aoi:prepared-line",
  color: "#86efac",
  fillOpacity: 0.14,
  dash: [1.5, 1],
};
const POPUP_FIELD_NAMES = [
  "power",
  "man_made",
  "industrial",
  "plant:source",
  "generator:source",
  "plant:output:heat",
  "generator:output:heat",
  "tower:type",
  "telecom",
  "communication",
  "communication:mobile_phone",
  "communication:radio",
  "communication:television",
  "communication:microwave",
  "cable",
  "amenity",
  "healthcare",
  "emergency",
  "highway",
  "railway",
  "aeroway",
  "road_class",
  "ref",
  "surface",
  "maxspeed",
  "lanes",
  "bridge",
  "tunnel",
  "oneway",
  "waterway",
  "pipeline",
  "substance",
  "diameter",
  "pumping",
  "gas",
  "pressure",
  "official_type",
  "iip_identifier",
  "jpt_id",
  "version_from",
  "voltage",
  "frequency",
  "operator",
  "circuits",
  "cables",
  "wires",
  "plant:method",
  "plant:output:electricity",
  "start_date",
  "description",
  "phone",
  "contact:phone",
  "opening_hours",
  "wheelchair",
];

export type AoiViewport = { geometry: Geometry; zoom: number };
type RelatedLine = { circuit: MapCircuit; member: MapCircuitMember };
type PowerPopupState = {
  sourceId: string;
  state: "loading" | "available" | "empty" | "unavailable";
  lines: RelatedLine[];
  detail?: string;
};

function providerLayerId(layer: PreviewLayer): string {
  return `${PROVIDER_PREFIX}${previewLayerKey(layer)}`;
}
function providerInteractiveLayerIds(layer: PreviewLayer): string[] {
  const id = providerLayerId(layer);
  return [id, `${id}-medium`, `${id}-low`, `${id}-fill`, `${id}-outline`];
}
function providerSourceId(archiveUrl: string): string {
  return `${PROVIDER_PREFIX}archive:${archiveUrl.replace(/[^a-z0-9]/gi, "_")}`;
}
function firstProviderInteractiveLayerId(map: maplibregl.Map): string | undefined {
  const style = map.getStyle();
  return style?.layers?.find(
    (l) =>
      l.id.startsWith(PROVIDER_PREFIX) && !l.id.endsWith("-fill") && !l.id.endsWith("-outline"),
  )?.id;
}
function geometryBounds(geometry: Geometry): [number, number, number, number] | null {
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
function wmsTileUrl(endpoint: string, wmsLayer: string, format: string): string {
  const parameters = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.3.0",
    REQUEST: "GetMap",
    LAYERS: wmsLayer,
    STYLES: "default",
    FORMAT: format,
    TRANSPARENT: "TRUE",
    CRS: "EPSG:3857",
    WIDTH: "256",
    HEIGHT: "256",
    BBOX: "{bbox-epsg-3857}",
  });
  return `${endpoint}?${parameters.toString().replace("%7Bbbox-epsg-3857%7D", "{bbox-epsg-3857}")}`;
}

async function registerMapSymbols(map: maplibregl.Map): Promise<void> {
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

function replaceAoiOutline(
  map: maplibregl.Map,
  style: {
    source: string;
    fill: string;
    line: string;
    color: string;
    fillOpacity: number;
    dash: number[];
  },
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

export function MapView({
  aoiId,
  layers,
  transportRoadClasses,
  references,
  orthophotoEnabled,
  basemapMode,
  draftAoiOutline,
  preparedAoiOutline,
  aoiViewport,
  selected,
  selectedDetail,
  selectedCircuit,
  selectedCircuitMember,
  pickingAoi,
  onSelectFeature,
  onCircuitChange,
  onCircuitMemberChange,
  onPickAoiPoint,
  onZoomChange,
}: {
  aoiId?: string;
  layers: PreviewLayer[];
  transportRoadClasses: Record<TransportRoadClass, boolean>;
  references: KiutReferenceLayer[];
  orthophotoEnabled: boolean;
  basemapMode: VisualBasemapMode;
  draftAoiOutline: Geometry | null;
  preparedAoiOutline: Geometry | null;
  aoiViewport: AoiViewport | null;
  selected: SelectedProviderFeature | null;
  selectedDetail: MapFeatureDetail | null;
  selectedCircuit: MapCircuit | null;
  selectedCircuitMember: MapCircuitMember | null;
  pickingAoi: boolean;
  onSelectFeature: (selected: SelectedProviderFeature | null) => void;
  onCircuitChange: (circuit: MapCircuit | null) => void;
  onCircuitMemberChange: (member: MapCircuitMember | null) => void;
  onPickAoiPoint: (point: { longitude: number; latitude: number }) => void;
  onZoomChange: (zoom: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const layersRef = useRef(layers);
  const onSelectFeatureRef = useRef(onSelectFeature);
  const onCircuitChangeRef = useRef(onCircuitChange);
  const onCircuitMemberChangeRef = useRef(onCircuitMemberChange);
  const onPickAoiPointRef = useRef(onPickAoiPoint);
  const onZoomChangeRef = useRef(onZoomChange);
  const pickingAoiRef = useRef(pickingAoi);
  const fittedArchiveRef = useRef<string | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [powerPopup, setPowerPopup] = useState<PowerPopupState | null>(null);
  const [selectedLineDetail, setSelectedLineDetail] = useState<MapFeatureDetail | null>(null);
  const [unavailableLineDetailForSourceId, setUnavailableLineDetailForSourceId] = useState<
    string | null
  >(null);

  useEffect(() => {
    layersRef.current = layers;
  }, [layers]);
  useEffect(() => {
    onSelectFeatureRef.current = onSelectFeature;
  }, [onSelectFeature]);
  useEffect(() => {
    onCircuitChangeRef.current = onCircuitChange;
  }, [onCircuitChange]);
  useEffect(() => {
    onCircuitMemberChangeRef.current = onCircuitMemberChange;
  }, [onCircuitMemberChange]);
  useEffect(() => {
    onPickAoiPointRef.current = onPickAoiPoint;
  }, [onPickAoiPoint]);
  useEffect(() => {
    onZoomChangeRef.current = onZoomChange;
  }, [onZoomChange]);
  useEffect(() => {
    pickingAoiRef.current = pickingAoi;
  }, [pickingAoi]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }
    const map = new maplibregl.Map({
      container: containerRef.current,
      center: [19.35, 52.05],
      zoom: 5.5,
      style: {
        version: 8,
        sources: {},
        layers: [
          { id: "background", type: "background", paint: { "background-color": "#0b1728" } },
        ],
      },
    });
    mapRef.current = map;
    void map.once("load", () => {
      void registerMapSymbols(map).finally(() => {
        onZoomChangeRef.current(map.getZoom());
        setMapReady(true);
      });
    });
    map.on("zoom", () => onZoomChangeRef.current(map.getZoom()));
    map.on("click", (event) => {
      if (pickingAoiRef.current) {
        onPickAoiPointRef.current({
          longitude: Number(event.lngLat.lng.toFixed(6)),
          latitude: Number(event.lngLat.lat.toFixed(6)),
        });
        return;
      }
      const visibleIds = layersRef.current
        .flatMap(providerInteractiveLayerIds)
        .filter((id) => map.getLayer(id));
      const rendered = map.queryRenderedFeatures(event.point, { layers: visibleIds })[0];
      if (!rendered) {
        return;
      }
      const layer = layersRef.current.find(
        (candidate) => candidate.artifact.source_layer === rendered.sourceLayer,
      );
      if (!layer) {
        return;
      }
      const feature = asProviderFeature(rendered);
      onSelectFeatureRef.current({ layer, feature });
    });
    map.on("mousemove", (event) => {
      const visibleIds = layersRef.current
        .flatMap(providerInteractiveLayerIds)
        .filter((id) => map.getLayer(id));
      map.getCanvas().style.cursor =
        visibleIds.length && map.queryRenderedFeatures(event.point, { layers: visibleIds }).length
          ? "pointer"
          : "";
    });
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const sourceId = selected?.feature.properties.source_id;
    if (!aoiId || selected?.layer.domain !== "power" || typeof sourceId !== "string") {
      return;
    }
    let cancelled = false;
    void fetch(
      `/api/aoi/${encodeURIComponent(aoiId)}/presentations/power/features/${encodeURIComponent(sourceId)}/circuits`,
    )
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Circuit list: HTTP ${response.status}`);
        }
        return response.json() as Promise<MapCircuitList>;
      })
      .then(async (list) => {
        if (list.state === "unavailable") {
          return {
            state: "unavailable" as const,
            lines: [] as RelatedLine[],
            detail: list.limitations?.[1] ?? list.limitations?.[0],
          };
        }
        if (list.state !== "available") {
          return { state: "empty" as const, lines: [] as RelatedLine[] };
        }
        const details = await Promise.all(
          list.circuits.map(async (summary) => {
            const response = await fetch(
              `/api/aoi/${encodeURIComponent(aoiId)}/presentations/power/circuits/${encodeURIComponent(summary.relation_id)}`,
            );
            if (!response.ok) {
              throw new Error(`Circuit details: HTTP ${response.status}`);
            }
            return response.json() as Promise<MapCircuitDetail>;
          }),
        );
        const lines = new Map<string, RelatedLine>();
        details.forEach(({ circuit }) =>
          circuit.members
            .filter((member) => member.geometry)
            .forEach((member) => lines.set(member.source_id, { circuit, member })),
        );
        return {
          state: lines.size ? ("available" as const) : ("empty" as const),
          lines: [...lines.values()],
        };
      })
      .then((result) => {
        if (cancelled) {
          return;
        }
        setPowerPopup({ sourceId, ...result });
        const directlySelectedLine = result.lines.find(
          (line) => line.member.source_id === sourceId,
        );
        if (directlySelectedLine) {
          onCircuitChangeRef.current(directlySelectedLine.circuit);
          // Don't auto-select individual member – show full circuit highlight
          // so all member ways are highlighted at once (like OpenInfraMap).
          // The user can still drill into a single member via the popup buttons.
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPowerPopup({
            sourceId,
            state: "unavailable",
            lines: [],
            detail: "Circuit evidence could not be recovered for this source feature.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [aoiId, selected]);

  useEffect(() => {
    const sourceId = selectedCircuitMember?.source_id;
    if (!aoiId || !sourceId) {
      return;
    }
    let cancelled = false;
    void fetch(
      `/api/aoi/${encodeURIComponent(aoiId)}/presentations/power/features/${encodeURIComponent(sourceId)}`,
    )
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Line details: HTTP ${response.status}`);
        }
        return response.json() as Promise<MapFeatureDetail>;
      })
      .then((detail) => {
        if (!cancelled) {
          setSelectedLineDetail(detail);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUnavailableLineDetailForSourceId(sourceId);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [aoiId, selectedCircuitMember]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) {
      return;
    }
    if (basemapMode === "none") {
      if (map.getLayer(BASEMAP_SOURCE_ID)) {
        map.removeLayer(BASEMAP_SOURCE_ID);
      }
      if (map.getSource(BASEMAP_SOURCE_ID)) {
        map.removeSource(BASEMAP_SOURCE_ID);
      }
      return;
    }
    if (!map.getSource(BASEMAP_SOURCE_ID)) {
      map.addSource(BASEMAP_SOURCE_ID, {
        type: "raster",
        tiles: [openStreetMapBasemap.tileUrlTemplate],
        tileSize: 256,
        attribution: openStreetMapBasemap.attribution,
        minzoom: openStreetMapBasemap.minZoom,
        maxzoom: openStreetMapBasemap.maxZoom,
      });
    }
    const paint = baseMapRasterPaint(basemapMode);
    if (!map.getLayer(BASEMAP_SOURCE_ID)) {
      map.addLayer({ id: BASEMAP_SOURCE_ID, type: "raster", source: BASEMAP_SOURCE_ID, paint });
      return;
    }
    Object.entries(paint).forEach(([property, value]) =>
      map.setPaintProperty(BASEMAP_SOURCE_ID, property, value),
    );
  }, [basemapMode, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) {
      return;
    }
    removePrefixedLayersAndSources(map, PROVIDER_PREFIX);
    const archives = new Map<string, PreviewLayer[]>();
    layers.forEach((layer) =>
      archives.set(layer.archiveUrl, [...(archives.get(layer.archiveUrl) ?? []), layer]),
    );
    archives.forEach((archiveLayers, archiveUrl) => {
      const sourceId = providerSourceId(archiveUrl);
      map.addSource(sourceId, {
        type: "vector",
        url: `pmtiles://${new URL(archiveUrl, window.location.origin).toString()}`,
        attribution: archiveLayers[0]?.artifact.attribution,
        minzoom: archiveLayers[0]?.archiveMinZoom ?? 0,
        maxzoom: archiveLayers[0]?.archiveMaxZoom ?? 22,
      });
      archiveLayers.forEach((layer, index) => {
        const id = providerLayerId(layer);
        const color = layerPresentationSemantic(layer, index).color;
        const isLine = isLinePresentationLayer(layer.artifact.source_layer);
        if (isLine) {
          if (layer.artifact.artifact_id === "transport.roads") {
            const enabledRoadClasses = Object.entries(transportRoadClasses)
              .filter(([, enabled]) => enabled)
              .map(([roadClass]) => roadClass);
            map.addLayer({
              id,
              type: "line",
              source: sourceId,
              "source-layer": layer.artifact.source_layer,
              minzoom: 11,
              filter: ["in", ["get", "road_class"], ["literal", enabledRoadClasses]],
              paint: { "line-color": roadLineColor, "line-width": 14, "line-opacity": 0 },
            });
          } else if (layer.artifact.artifact_id === "transport.railways") {
            map.addLayer({
              id,
              type: "line",
              source: sourceId,
              "source-layer": layer.artifact.source_layer,
              minzoom: 11,
              paint: { "line-color": "#cbd5e1", "line-width": 14, "line-opacity": 0 },
            });
          } else if (layer.artifact.artifact_id === "bridges.bridges") {
            map.addLayer({
              id,
              type: "line",
              source: sourceId,
              "source-layer": layer.artifact.source_layer,
              minzoom: 10,
              paint: { "line-color": "#0284c7", "line-width": 5, "line-opacity": 0.95 },
            });
            map.addLayer({
              id: `${id}-labels`,
              type: "symbol",
              source: sourceId,
              "source-layer": layer.artifact.source_layer,
              minzoom: 11,
              filter: ["has", "name"],
              layout: {
                "symbol-placement": "line",
                "text-field": ["get", "name"],
                "text-size": 11,
                "text-max-angle": 35,
              },
              paint: {
                "text-color": "#e0f2fe",
                "text-halo-color": "#0369a1",
                "text-halo-width": 1.5,
              },
            });
          } else if (layer.artifact.artifact_id === "bridges.viaducts") {
            map.addLayer({
              id,
              type: "line",
              source: sourceId,
              "source-layer": layer.artifact.source_layer,
              minzoom: 10,
              paint: { "line-color": "#a855f7", "line-width": 5, "line-opacity": 0.95 },
            });
            map.addLayer({
              id: `${id}-labels`,
              type: "symbol",
              source: sourceId,
              "source-layer": layer.artifact.source_layer,
              minzoom: 11,
              filter: ["has", "name"],
              layout: {
                "symbol-placement": "line",
                "text-field": ["get", "name"],
                "text-size": 11,
                "text-max-angle": 35,
              },
              paint: {
                "text-color": "#f3e8ff",
                "text-halo-color": "#6b21a8",
                "text-halo-width": 1.5,
              },
            });
          } else if (layer.artifact.artifact_id === "water.waterways") {
            map.addLayer({
              id,
              type: "line",
              source: sourceId,
              "source-layer": layer.artifact.source_layer,
              minzoom: 10,
              paint: { "line-color": "#0284c7", "line-width": 14, "line-opacity": 0 },
            });
          } else if (layer.artifact.artifact_id === "water.pipelines") {
            map.addLayer({
              id,
              type: "line",
              source: sourceId,
              "source-layer": layer.artifact.source_layer,
              minzoom: 10,
              paint: {
                "line-color": "#06b6d4",
                "line-width": 4,
                "line-dasharray": [4, 2],
                "line-opacity": 0.95,
              },
            });
            map.addLayer({
              id: `${id}-labels`,
              type: "symbol",
              source: sourceId,
              "source-layer": layer.artifact.source_layer,
              minzoom: 11,
              filter: ["has", "name"],
              layout: {
                "symbol-placement": "line",
                "text-field": ["get", "name"],
                "text-size": 11,
                "text-max-angle": 35,
              },
              paint: {
                "text-color": "#cffafe",
                "text-halo-color": "#0e7490",
                "text-halo-width": 1.5,
              },
            });
          } else if (layer.artifact.artifact_id === "gas.pipelines") {
            map.addLayer({
              id,
              type: "line",
              source: sourceId,
              "source-layer": layer.artifact.source_layer,
              minzoom: 10,
              paint: {
                "line-color": "#f97316",
                "line-width": 4,
                "line-dasharray": [4, 2],
                "line-opacity": 0.95,
              },
            });
            map.addLayer({
              id: `${id}-labels`,
              type: "symbol",
              source: sourceId,
              "source-layer": layer.artifact.source_layer,
              minzoom: 11,
              filter: ["has", "name"],
              layout: {
                "symbol-placement": "line",
                "text-field": ["get", "name"],
                "text-size": 11,
                "text-max-angle": 35,
              },
              paint: {
                "text-color": "#ffedd5",
                "text-halo-color": "#c2410c",
                "text-halo-width": 1.5,
              },
            });
          } else if (layer.artifact.artifact_id === "sewer.pipelines") {
            map.addLayer({
              id,
              type: "line",
              source: sourceId,
              "source-layer": layer.artifact.source_layer,
              minzoom: 10,
              paint: {
                "line-color": "#78350f",
                "line-width": 4,
                "line-dasharray": [4, 2],
                "line-opacity": 0.95,
              },
            });
            map.addLayer({
              id: `${id}-labels`,
              type: "symbol",
              source: sourceId,
              "source-layer": layer.artifact.source_layer,
              minzoom: 11,
              filter: ["has", "name"],
              layout: {
                "symbol-placement": "line",
                "text-field": ["get", "name"],
                "text-size": 11,
                "text-max-angle": 35,
              },
              paint: {
                "text-color": "#fef3c7",
                "text-halo-color": "#451a03",
                "text-halo-width": 1.5,
              },
            });
          } else if (layer.artifact.artifact_id === "telecom.lines") {
            map.addLayer({
              id,
              type: "line",
              source: sourceId,
              "source-layer": layer.artifact.source_layer,
              minzoom: 10,
              paint: {
                "line-color": "#8b5cf6",
                "line-width": 4,
                "line-dasharray": [3, 2],
                "line-opacity": 0.95,
              },
            });
            map.addLayer({
              id: `${id}-labels`,
              type: "symbol",
              source: sourceId,
              "source-layer": layer.artifact.source_layer,
              minzoom: 11,
              filter: ["has", "name"],
              layout: {
                "symbol-placement": "line",
                "text-field": ["get", "name"],
                "text-size": 11,
                "text-max-angle": 35,
              },
              paint: {
                "text-color": "#ede9fe",
                "text-halo-color": "#5b21b6",
                "text-halo-width": 1.5,
              },
            });
          } else if (layer.artifact.artifact_id === "district_heating.lines") {
            map.addLayer({
              id,
              type: "line",
              source: sourceId,
              "source-layer": layer.artifact.source_layer,
              minzoom: 10,
              paint: {
                "line-color": "#dc2626",
                "line-width": 4,
                "line-dasharray": [6, 2],
                "line-opacity": 0.95,
              },
            });
            map.addLayer({
              id: `${id}-labels`,
              type: "symbol",
              source: sourceId,
              "source-layer": layer.artifact.source_layer,
              minzoom: 11,
              filter: ["has", "name"],
              layout: {
                "symbol-placement": "line",
                "text-field": ["get", "name"],
                "text-size": 11,
                "text-max-angle": 35,
              },
              paint: {
                "text-color": "#fee2e2",
                "text-halo-color": "#991b1b",
                "text-halo-width": 1.5,
              },
            });
          } else if (layer.domain === "power" || layer.artifact.source_layer.includes("power")) {
            const base = {
              type: "line" as const,
              source: sourceId,
              "source-layer": layer.artifact.source_layer,
              paint: { "line-color": voltageLineColor, "line-width": 4.5, "line-opacity": 0.9 },
            };
            map.addLayer({
              ...base,
              id,
              filter: [
                "all",
                ["!=", ["get", "voltage_bucket"], "medium"],
                ["!=", ["get", "voltage_bucket"], "low"],
              ],
            });
            map.addLayer({
              ...base,
              id: `${id}-medium`,
              minzoom: 11,
              filter: ["==", ["get", "voltage_bucket"], "medium"],
            });
            map.addLayer({
              ...base,
              id: `${id}-low`,
              minzoom: 13,
              filter: ["==", ["get", "voltage_bucket"], "low"],
            });
            map.addLayer({
              id: `${id}-labels-transmission`,
              type: "symbol",
              source: sourceId,
              "source-layer": layer.artifact.source_layer,
              minzoom: powerVoltageLabelMinZoom.transmission,
              filter: [
                "all",
                ["!=", ["get", "voltage_bucket"], "medium"],
                ["!=", ["get", "voltage_bucket"], "low"],
                ["!=", ["get", "voltage_bucket"], "unknown"],
              ],
              layout: {
                "symbol-placement": "line",
                "text-field": ["get", "voltage_label"],
                "text-size": 11,
                "text-max-angle": 35,
              },
              paint: {
                "text-color": "#f8fafc",
                "text-halo-color": "#0f172a",
                "text-halo-width": 1.5,
              },
            });
            map.addLayer({
              id: `${id}-labels-medium`,
              type: "symbol",
              source: sourceId,
              "source-layer": layer.artifact.source_layer,
              minzoom: powerVoltageLabelMinZoom.medium,
              filter: ["==", ["get", "voltage_bucket"], "medium"],
              layout: {
                "symbol-placement": "line",
                "text-field": ["get", "voltage_label"],
                "text-size": 11,
                "text-max-angle": 35,
              },
              paint: {
                "text-color": "#f8fafc",
                "text-halo-color": "#0f172a",
                "text-halo-width": 1.5,
              },
            });
            map.addLayer({
              id: `${id}-labels-low`,
              type: "symbol",
              source: sourceId,
              "source-layer": layer.artifact.source_layer,
              minzoom: powerVoltageLabelMinZoom.low,
              filter: ["==", ["get", "voltage_bucket"], "low"],
              layout: {
                "symbol-placement": "line",
                "text-field": ["get", "voltage_label"],
                "text-size": 11,
                "text-max-angle": 35,
              },
              paint: {
                "text-color": "#f8fafc",
                "text-halo-color": "#0f172a",
                "text-halo-width": 1.5,
              },
            });
          } else {
            map.addLayer({
              id,
              type: "line",
              source: sourceId,
              "source-layer": layer.artifact.source_layer,
              paint: { "line-color": color, "line-width": 4, "line-opacity": 0.9 },
            });
          }
        } else {
          const minzoom =
            layer.domain === "emergency" ||
            layer.domain === "gas" ||
            layer.domain === "sewer" ||
            layer.domain === "industrial" ||
            layer.domain === "telecom" ||
            layer.domain === "district_heating"
              ? 9
              : 12;
          const areaColor = color;
          map.addLayer({
            id: `${id}-fill`,
            type: "fill",
            source: sourceId,
            "source-layer": layer.artifact.source_layer,
            minzoom,
            filter: ["==", ["geometry-type"], "Polygon"],
            paint: { "fill-color": areaColor, "fill-opacity": 0.22 },
          });
          map.addLayer({
            id: `${id}-outline`,
            type: "line",
            source: sourceId,
            "source-layer": layer.artifact.source_layer,
            minzoom,
            filter: ["==", ["geometry-type"], "Polygon"],
            paint: { "line-color": areaColor, "line-width": 2, "line-opacity": 0.86 },
          });
          map.addLayer({
            id,
            type: "symbol",
            source: sourceId,
            "source-layer": layer.artifact.source_layer,
            minzoom,
            filter: ["in", ["geometry-type"], ["literal", ["Point", "Polygon"]]],
            layout: {
              "icon-image": pointSymbolExpression(layer),
              "icon-size": pointSymbolSize(layer),
              "icon-allow-overlap": false,
              "icon-ignore-placement": false,
            },
          });
        }
      });
      const bounds = archiveLayers[0]?.archiveBounds;
      if (bounds && fittedArchiveRef.current !== archiveUrl) {
        map.fitBounds(
          [
            [bounds[0], bounds[1]],
            [bounds[2], bounds[3]],
          ],
          { padding: 28, maxZoom: 10 },
        );
        fittedArchiveRef.current = archiveUrl;
      }
    });
  }, [layers, mapReady, transportRoadClasses]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) {
      return;
    }
    removePrefixedLayersAndSources(map, REFERENCE_PREFIX);
    if (orthophotoEnabled) {
      addRasterReference(
        map,
        "orthophoto",
        ORTHOPHOTO_WMS_URL,
        orthophotoReference.wmsLayer,
        "image/jpeg",
        orthophotoReference.attribution,
        0,
        20,
      );
    }
    references.forEach((reference) =>
      addRasterReference(
        map,
        reference.id,
        KIUT_WMS_URL,
        reference.wmsLayer,
        "image/png",
        "GUGiK, KIUT/GESUT WMS",
        KIUT_MIN_ZOOM,
        KIUT_MAX_ZOOM,
      ),
    );
    if (references.length && map.getZoom() < KIUT_MIN_ZOOM) {
      map.setZoom(KIUT_MIN_ZOOM);
    }
  }, [references, orthophotoEnabled, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) {
      return;
    }
    replaceAoiOutline(map, PREPARED_AOI_OUTLINE, preparedAoiOutline);
    replaceAoiOutline(map, DRAFT_AOI_OUTLINE, draftAoiOutline);
  }, [draftAoiOutline, mapReady, preparedAoiOutline]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !aoiViewport) {
      return;
    }
    const bounds = geometryBounds(aoiViewport.geometry);
    if (!bounds) {
      return;
    }
    map.easeTo({
      center: [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2],
      zoom: aoiViewport.zoom,
      duration: 650,
      essential: true,
    });
  }, [aoiViewport, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) {
      return;
    }
    if (map.getLayer(CIRCUIT_ENDPOINT_ID)) {
      map.removeLayer(CIRCUIT_ENDPOINT_ID);
    }
    if (map.getLayer(CIRCUIT_LINE_ID)) {
      map.removeLayer(CIRCUIT_LINE_ID);
    }
    if (map.getLayer(CIRCUIT_GLOW_OUTER_ID)) {
      map.removeLayer(CIRCUIT_GLOW_OUTER_ID);
    }
    if (map.getSource(CIRCUIT_SOURCE_ID)) {
      map.removeSource(CIRCUIT_SOURCE_ID);
    }
    if (!selectedCircuit || selectedCircuitMember) {
      return;
    }
    const members = selectedCircuit.members.filter((member) => member.geometry);
    const lines = members.map((member) => ({
      type: "Feature" as const,
      properties: { source_id: member.source_id, role: member.role },
      geometry: member.geometry!,
    }));
    const endpoints = members.flatMap((member) => {
      const coordinates = member.geometry!.coordinates;
      return [coordinates[0], coordinates.at(-1)!].map((coordinate) => ({
        type: "Feature" as const,
        properties: { source_id: member.source_id },
        geometry: { type: "Point" as const, coordinates: coordinate },
      }));
    });
    map.addSource(CIRCUIT_SOURCE_ID, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [...lines, ...endpoints] },
    });
    const beforeId = firstProviderInteractiveLayerId(map);
    map.addLayer(
      {
        id: CIRCUIT_GLOW_OUTER_ID,
        type: "line",
        source: CIRCUIT_SOURCE_ID,
        filter: ["==", ["geometry-type"], "LineString"],
        paint: {
          "line-color": "#facc15",
          "line-width": 13,
          "line-opacity": 0.65,
          "line-blur": 3.5,
        },
      },
      beforeId,
    );
    map.addLayer(
      {
        id: CIRCUIT_LINE_ID,
        type: "line",
        source: CIRCUIT_SOURCE_ID,
        filter: ["==", ["geometry-type"], "LineString"],
        paint: {
          "line-color": "#fef08a",
          "line-width": 7.5,
          "line-opacity": 0.9,
          "line-blur": 0.6,
        },
      },
      beforeId,
    );
    map.addLayer({
      id: CIRCUIT_ENDPOINT_ID,
      type: "circle",
      source: CIRCUIT_SOURCE_ID,
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-color": "rgba(250, 204, 21, 0.25)",
        "circle-radius": 6.5,
        "circle-stroke-color": "#fde047",
        "circle-stroke-width": 2,
      },
    });
  }, [mapReady, selectedCircuit, selectedCircuitMember, layers]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) {
      return;
    }
    if (map.getLayer(CIRCUIT_MEMBER_ENDPOINT_ID)) {
      map.removeLayer(CIRCUIT_MEMBER_ENDPOINT_ID);
    }
    if (map.getLayer(CIRCUIT_MEMBER_LINE_ID)) {
      map.removeLayer(CIRCUIT_MEMBER_LINE_ID);
    }
    if (map.getLayer(CIRCUIT_MEMBER_HALO_ID)) {
      map.removeLayer(CIRCUIT_MEMBER_HALO_ID);
    }
    if (map.getLayer(CIRCUIT_MEMBER_GLOW_OUTER_ID)) {
      map.removeLayer(CIRCUIT_MEMBER_GLOW_OUTER_ID);
    }
    if (map.getSource(CIRCUIT_MEMBER_SOURCE_ID)) {
      map.removeSource(CIRCUIT_MEMBER_SOURCE_ID);
    }
    if (!selectedCircuitMember?.geometry) {
      return;
    }
    const coordinates = selectedCircuitMember.geometry.coordinates;
    map.addSource(CIRCUIT_MEMBER_SOURCE_ID, {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { source_id: selectedCircuitMember.source_id },
            geometry: selectedCircuitMember.geometry,
          },
          {
            type: "Feature",
            properties: { endpoint: "start" },
            geometry: { type: "Point", coordinates: coordinates[0] },
          },
          {
            type: "Feature",
            properties: { endpoint: "end" },
            geometry: { type: "Point", coordinates: coordinates.at(-1)! },
          },
        ],
      },
    });
    const beforeId = firstProviderInteractiveLayerId(map);
    map.addLayer(
      {
        id: CIRCUIT_MEMBER_GLOW_OUTER_ID,
        type: "line",
        source: CIRCUIT_MEMBER_SOURCE_ID,
        filter: ["==", ["geometry-type"], "LineString"],
        paint: { "line-color": "#f59e0b", "line-width": 15, "line-opacity": 0.7, "line-blur": 4 },
      },
      beforeId,
    );
    map.addLayer(
      {
        id: CIRCUIT_MEMBER_HALO_ID,
        type: "line",
        source: CIRCUIT_MEMBER_SOURCE_ID,
        filter: ["==", ["geometry-type"], "LineString"],
        paint: {
          "line-color": "#fde047",
          "line-width": 8.5,
          "line-opacity": 0.95,
          "line-blur": 0.5,
        },
      },
      beforeId,
    );
    map.addLayer({
      id: CIRCUIT_MEMBER_ENDPOINT_ID,
      type: "circle",
      source: CIRCUIT_MEMBER_SOURCE_ID,
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-color": "rgba(245, 158, 11, 0.35)",
        "circle-radius": 7.5,
        "circle-stroke-color": "#fef08a",
        "circle-stroke-width": 2.5,
      },
    });
  }, [mapReady, selectedCircuitMember, layers]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) {
      return;
    }
    if (map.getLayer(SELECTED_FEATURE_ENDPOINT_ID)) {
      map.removeLayer(SELECTED_FEATURE_ENDPOINT_ID);
    }
    if (map.getLayer(SELECTED_FEATURE_LINE_ID)) {
      map.removeLayer(SELECTED_FEATURE_LINE_ID);
    }
    if (map.getLayer(SELECTED_FEATURE_GLOW_OUTER_ID)) {
      map.removeLayer(SELECTED_FEATURE_GLOW_OUTER_ID);
    }
    if (map.getSource(SELECTED_FEATURE_SOURCE_ID)) {
      map.removeSource(SELECTED_FEATURE_SOURCE_ID);
    }
    const detail =
      selectedDetail?.source_id === selected?.feature.properties.source_id ? selectedDetail : null;
    const feature = detail ? detail.feature : selected?.feature;
    if (
      !feature?.geometry ||
      (feature.geometry.type !== "LineString" && feature.geometry.type !== "MultiLineString") ||
      isPopupOnlyNetworkArtifact(selected?.layer.artifact.artifact_id ?? "") ||
      (selected?.layer.domain === "power" && selectedCircuitMember)
    ) {
      return;
    }
    const features: Array<{
      type: "Feature";
      properties: Record<string, unknown>;
      geometry: Geometry;
    }> = [{ type: "Feature", properties: {}, geometry: feature.geometry }];
    if (feature.geometry.type === "LineString") {
      const coords = feature.geometry.coordinates;
      if (coords.length > 0) {
        features.push({
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: coords[0] },
        });
        features.push({
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: coords[coords.length - 1] },
        });
      }
    }
    map.addSource(SELECTED_FEATURE_SOURCE_ID, {
      type: "geojson",
      data: { type: "FeatureCollection", features },
    });
    const beforeId = firstProviderInteractiveLayerId(map);
    const isPower = selected?.layer.domain === "power";
    const glowColor = isPower ? "#facc15" : "#38bdf8";
    const haloColor = isPower ? "#fef08a" : "#7dd3fc";

    map.addLayer(
      {
        id: SELECTED_FEATURE_GLOW_OUTER_ID,
        type: "line",
        source: SELECTED_FEATURE_SOURCE_ID,
        filter: ["in", ["geometry-type"], ["literal", ["LineString", "MultiLineString"]]],
        paint: {
          "line-color": glowColor,
          "line-width": 13,
          "line-opacity": 0.65,
          "line-blur": 3.5,
        },
      },
      beforeId,
    );
    map.addLayer(
      {
        id: SELECTED_FEATURE_LINE_ID,
        type: "line",
        source: SELECTED_FEATURE_SOURCE_ID,
        filter: ["in", ["geometry-type"], ["literal", ["LineString", "MultiLineString"]]],
        paint: {
          "line-color": haloColor,
          "line-width": 7.5,
          "line-opacity": 0.9,
          "line-blur": 0.6,
        },
      },
      beforeId,
    );
    map.addLayer({
      id: SELECTED_FEATURE_ENDPOINT_ID,
      type: "circle",
      source: SELECTED_FEATURE_SOURCE_ID,
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-color": isPower ? "rgba(250, 204, 21, 0.25)" : "rgba(56, 189, 248, 0.25)",
        "circle-radius": 6.5,
        "circle-stroke-color": haloColor,
        "circle-stroke-width": 2,
      },
    });
  }, [mapReady, selected, selectedDetail, selectedCircuitMember, layers]);

  const zoomToSelected = () => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    if (selectedCircuitMember?.geometry) {
      const bounds = geometryBounds(selectedCircuitMember.geometry);
      if (bounds) {
        map.fitBounds(
          [
            [bounds[0], bounds[1]],
            [bounds[2], bounds[3]],
          ],
          {
            padding: { top: 96, right: 380, bottom: 96, left: 84 },
            maxZoom: 15,
            duration: 500,
            essential: true,
          },
        );
        return;
      }
    }

    if (selectedCircuit?.members) {
      const memberGeoms = selectedCircuit.members.filter((m) => m.geometry).map((m) => m.geometry!);
      if (memberGeoms.length > 0) {
        const collection: Geometry = {
          type: "GeometryCollection",
          geometries: memberGeoms,
        };
        const bounds = geometryBounds(collection);
        if (bounds) {
          map.fitBounds(
            [
              [bounds[0], bounds[1]],
              [bounds[2], bounds[3]],
            ],
            {
              padding: { top: 96, right: 380, bottom: 96, left: 84 },
              maxZoom: 14,
              duration: 500,
              essential: true,
            },
          );
          return;
        }
      }
    }

    const detail =
      selectedDetail?.source_id === selected?.feature.properties.source_id ? selectedDetail : null;
    const feature = detail ? detail.feature : selected?.feature;
    if (feature?.geometry) {
      const bounds = geometryBounds(feature.geometry);
      if (bounds) {
        if (bounds[0] === bounds[2] && bounds[1] === bounds[3]) {
          map.easeTo({
            center: [bounds[0], bounds[1]],
            zoom: Math.max(map.getZoom(), 15),
            duration: 500,
            essential: true,
          });
        } else {
          map.fitBounds(
            [
              [bounds[0], bounds[1]],
              [bounds[2], bounds[3]],
            ],
            {
              padding: { top: 96, right: 380, bottom: 96, left: 84 },
              maxZoom: 15,
              duration: 500,
              essential: true,
            },
          );
        }
      }
    }
  };

  const clearSelection = () => {
    onSelectFeature(null);
    onCircuitChange(null);
    onCircuitMemberChange(null);
  };

  return (
    <div className="mapPanel">
      {selected && (
        <FeaturePopupPanel
          selected={selected}
          selectedDetail={selectedDetail}
          selectedCircuit={selectedCircuit}
          selectedCircuitMember={selectedCircuitMember}
          selectedLineDetail={selectedLineDetail}
          unavailableLineDetailForSourceId={unavailableLineDetailForSourceId}
          powerPopup={powerPopup}
          onClose={clearSelection}
          onSelectCircuitLine={(line) => {
            onCircuitChange(line.circuit);
            onCircuitMemberChange(line.member);
          }}
          onDeselectCircuitMember={() => onCircuitMemberChange(null)}
          onZoom={zoomToSelected}
        />
      )}
      <div className="map" ref={containerRef} />
    </div>
  );
}

function FeaturePopupPanel({
  selected,
  selectedDetail,
  selectedCircuit,
  selectedCircuitMember,
  selectedLineDetail,
  unavailableLineDetailForSourceId,
  powerPopup,
  onClose,
  onSelectCircuitLine,
  onDeselectCircuitMember,
  onZoom,
}: {
  selected: SelectedProviderFeature;
  selectedDetail: MapFeatureDetail | null;
  selectedCircuit: MapCircuit | null;
  selectedCircuitMember: MapCircuitMember | null;
  selectedLineDetail: MapFeatureDetail | null;
  unavailableLineDetailForSourceId: string | null;
  powerPopup: PowerPopupState | null;
  onClose: () => void;
  onSelectCircuitLine: (line: RelatedLine) => void;
  onDeselectCircuitMember: () => void;
  onZoom: () => void;
}) {
  const { layer } = selected;
  const detail =
    selectedDetail?.source_id === selected.feature.properties.source_id ? selectedDetail : null;
  const feature = detail ? detail.feature : selected.feature;
  const details = popupDetails(feature, layer);
  const properties = feature.properties;
  const tags = {
    ...asStringRecord(properties.osm_tags),
    ...asStringRecord(properties.source_attributes),
  };
  const sourceId = typeof properties.source_id === "string" ? properties.source_id : "";
  const sourceLink = /^((node|way|relation)\/\d+)$/.test(sourceId)
    ? `https://www.openstreetmap.org/${sourceId}`
    : null;

  const roadClass =
    typeof properties.road_class === "string"
      ? properties.road_class
      : typeof tags.highway === "string"
        ? tags.highway
        : undefined;
  const rawVoltage = properties.voltage_label ?? tags.voltage;
  const voltageLabel =
    typeof rawVoltage === "string" || typeof rawVoltage === "number"
      ? formatVoltage(String(rawVoltage))
      : "voltage unknown";
  const assetType = typeof properties.asset_type === "string" ? properties.asset_type : "feature";
  const featureName =
    typeof properties.name === "string"
      ? properties.name
      : typeof tags.name === "string"
        ? tags.name
        : details.title;
  const operatorOrSource = typeof tags.operator === "string" ? tags.operator : details.source;

  const classification =
    properties.domain === "power"
      ? voltageLabel
      : properties.domain === "transport" && roadClass
        ? `road (${roadClass})`
        : assetType.replaceAll("_", " ");

  const directLineDetail =
    selectedDetail?.source_id === selectedCircuitMember?.source_id ? selectedDetail : null;
  const inspectedLineDetail =
    directLineDetail ??
    (selectedLineDetail?.source_id === selectedCircuitMember?.source_id
      ? selectedLineDetail
      : null);

  const displayProperties = inspectedLineDetail
    ? inspectedLineDetail.feature.properties
    : properties;
  const attributeEntries = popupAttributeEntries(displayProperties);

  const isPower = layer.domain === "power";
  const relevantPowerPopup =
    powerPopup?.sourceId === selected.feature.properties.source_id ? powerPopup : null;

  const extLinks = [
    sourceLink && { href: sourceLink, label: "OpenStreetMap" },
    tags.website && isValidHttpUrl(tags.website) && { href: tags.website, label: "Website" },
    tags.wikipedia &&
      parseWikipediaUrl(tags.wikipedia) && {
        href: parseWikipediaUrl(tags.wikipedia)!,
        label: "Wikipedia",
      },
    tags.wikidata &&
      /^Q\d+$/.test(tags.wikidata) && {
        href: `https://www.wikidata.org/wiki/${tags.wikidata}`,
        label: "Wikidata",
      },
    tags.image && isValidHttpUrl(tags.image) && { href: tags.image, label: "Source image" },
  ].filter(Boolean) as Array<{ href: string; label: string }>;

  return (
    <section
      className={`mapFeaturePanel ${isPower ? "isPower" : ""}`}
      aria-label="Selected feature details"
    >
      <CloseButton
        className="mapFeaturePanelClose"
        ariaLabel="Close feature details"
        title="Close feature details"
        onClick={onClose}
      />

      <header className="mapFeaturePanelHeader">
        <strong>{featureName}</strong>
        <span className="mapFeaturePanelSubtitle">
          {classification} · {operatorOrSource}
        </span>
      </header>

      <div className="mapFeaturePanelMeta">
        {sourceLink ? (
          <span className="mapFeaturePanelSourceId">
            <a href={sourceLink} target="_blank" rel="noreferrer">
              {sourceId}
            </a>
          </span>
        ) : (
          sourceId && <span className="mapFeaturePanelSourceId">{sourceId}</span>
        )}

        {extLinks.length > 0 && (
          <div className="mapFeaturePanelLinks">
            {extLinks.map((link, idx) => (
              <Fragment key={link.label}>
                {idx > 0 && <span>·</span>}
                <a href={link.href} target="_blank" rel="noreferrer">
                  {link.label}
                </a>
              </Fragment>
            ))}
          </div>
        )}
      </div>

      {selectedCircuitMember && (
        <div className="circuitMemberBadge">
          <span>
            Selected line: <strong>{selectedCircuitMember.source_id}</strong>
          </span>
          <button type="button" onClick={onDeselectCircuitMember}>
            Show full circuit
          </button>
        </div>
      )}

      {attributeEntries.length > 0 && (
        <section className="mapFeaturePanelSection">
          <span className="mapFeaturePanelSectionTitle">Attributes</span>
          <dl className="mapFeaturePanelDl">
            {attributeEntries.map(([name, value]) => (
              <Fragment key={name}>
                <dt>{name}</dt>
                <dd>{name === "voltage" ? formatVoltage(value) : value}</dd>
              </Fragment>
            ))}
          </dl>
          {selectedCircuitMember && !inspectedLineDetail && (
            <small className="muted">
              {unavailableLineDetailForSourceId === selectedCircuitMember.source_id
                ? "Full source attributes are unavailable for this cached line."
                : "Loading source attributes…"}
            </small>
          )}
        </section>
      )}

      {isPower && (
        <section className="mapFeaturePanelSection">
          <span className="mapFeaturePanelSectionTitle">Verified circuit lines</span>
          {!relevantPowerPopup || relevantPowerPopup.state === "loading" ? (
            <small className="muted">Loading committed circuit evidence…</small>
          ) : relevantPowerPopup.state === "available" ? (
            <div className="popupCircuitList">
              {relevantPowerPopup.lines.map((line) => {
                const isMemberSelected = selectedCircuitMember?.source_id === line.member.source_id;
                return (
                  <button
                    key={line.member.source_id}
                    type="button"
                    className={`popupCircuitButton ${isMemberSelected ? "active" : ""}`}
                    onClick={() => onSelectCircuitLine(line)}
                  >
                    <strong>Line {line.member.source_id}</strong>
                    <small>
                      {String(line.circuit.tags.name ?? line.circuit.relation_id)}
                      {line.member.endpoint_evidence
                        ? ` · ${line.member.endpoint_evidence.start} → ${line.member.endpoint_evidence.end}`
                        : " · source geometry verified"}
                    </small>
                  </button>
                );
              })}
            </div>
          ) : (
            <small className="muted">
              {relevantPowerPopup.state === "empty"
                ? "No committed circuit line is available for this feature."
                : (relevantPowerPopup.detail ??
                  "Circuit evidence is unavailable for this cached snapshot.")}
            </small>
          )}
        </section>
      )}

      <div className="mapFeaturePanelActions">
        <button type="button" className="mapFeaturePanelZoomBtn" onClick={onZoom}>
          Zoom to {selectedCircuitMember ? "line" : selectedCircuit ? "circuit" : "feature"}
        </button>
      </div>
    </section>
  );
}

function popupAttributeEntries(properties: ProviderFeature["properties"]): Array<[string, string]> {
  const tags = {
    ...asStringRecord(properties.osm_tags),
    ...asStringRecord(properties.source_attributes),
  };
  return POPUP_FIELD_NAMES.filter(
    (name) => tags[name] || (name === "road_class" && typeof properties.road_class === "string"),
  ).map((name) => [name, String(tags[name] ?? properties[name] ?? "")] as [string, string]);
}

function formatVoltage(value: string | undefined): string {
  if (!value) {
    return "unknown";
  }
  const values = value
    .split(";")
    .map((part) => Number(part.trim()))
    .filter(Number.isFinite);
  return values.length ? `${values.map((volts) => volts / 1000).join("/")} kV` : value;
}

function asStringRecord(value: unknown): Record<string, string> {
  return value && typeof value === "object"
    ? Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      )
    : {};
}

function isValidHttpUrl(value: string | undefined): boolean {
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

function parseWikipediaUrl(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const [language, ...title] = value.split(":");
  if (!/^[a-z-]{2,12}$/i.test(language) || !title.join(":")) {
    return null;
  }
  return `https://${language}.wikipedia.org/wiki/${encodeURIComponent(title.join(":"))}`;
}

function asProviderFeature(feature: MapGeoJSONFeature): ProviderFeature {
  return {
    type: "Feature",
    properties: feature.properties ?? {},
    geometry: feature.geometry,
  };
}

function addRasterReference(
  map: maplibregl.Map,
  key: string,
  endpoint: string,
  wmsLayer: string,
  format: string,
  attribution: string,
  minzoom: number,
  maxzoom: number,
): void {
  const sourceId = `${REFERENCE_PREFIX}${key}`;
  map.addSource(sourceId, {
    type: "raster",
    tiles: [wmsTileUrl(endpoint, wmsLayer, format)],
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
      maxzoom,
      paint: { "raster-opacity": key === "orthophoto" ? 0.8 : 0.72 },
    },
    referenceRasterInsertionPoint(map.getStyle().layers?.map((layer) => layer.id) ?? []),
  );
}

function removePrefixedLayersAndSources(map: maplibregl.Map, prefix: string): void {
  map
    .getStyle()
    .layers?.filter((layer) => layer.id.startsWith(prefix))
    .forEach((layer) => map.removeLayer(layer.id));
  Object.keys(map.getStyle().sources)
    .filter((sourceId) => sourceId.startsWith(prefix))
    .forEach((sourceId) => map.removeSource(sourceId));
}
