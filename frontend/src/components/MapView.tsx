import { useEffect, useRef, useState } from "react";
import maplibregl, { type CircleLayerSpecification, type ExpressionSpecification, type MapGeoJSONFeature } from "maplibre-gl";
import type { Geometry } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
import { Protocol } from "pmtiles";

import { popupDetails, previewLayerKey, type PreviewLayer, type TransportRoadClass } from "../previewCatalog";
import type { MapCircuit, MapFeatureDetail, ProviderFeature } from "../types/api";
import type { SelectedProviderFeature } from "../inspection";
import { KIUT_MAX_ZOOM, KIUT_MIN_ZOOM, KIUT_WMS_URL, type KiutReferenceLayer } from "../kiutReference";
import { ORTHOPHOTO_WMS_URL, orthophotoReference } from "../orthophotoReference";
import { isLinePresentationLayer, openStreetMapBasemap, presentationColor, referenceRasterInsertionPoint, roadLineColor, voltageLineColor } from "../mapStyle";

const pmtilesProtocol = new Protocol();
maplibregl.addProtocol("pmtiles", pmtilesProtocol.tile);

const PROVIDER_PREFIX = "provider:";
const REFERENCE_PREFIX = "reference:";
const BASEMAP_SOURCE_ID = "basemap:openstreetmap";
const CIRCUIT_SOURCE_ID = "circuit:selected";
const CIRCUIT_LINE_ID = "circuit:selected-line";
const CIRCUIT_ENDPOINT_ID = "circuit:selected-endpoints";
const SELECTED_FEATURE_SOURCE_ID = "selected:feature";
const SELECTED_FEATURE_LINE_ID = "selected:feature-line";
const SELECTED_FEATURE_ENDPOINT_ID = "selected:feature-endpoints";
const AOI_OUTLINE_SOURCE_ID = "aoi:selected";
const AOI_OUTLINE_FILL_ID = "aoi:selected-fill";
const AOI_OUTLINE_LINE_ID = "aoi:selected-line";

function providerLayerId(layer: PreviewLayer): string { return `${PROVIDER_PREFIX}${previewLayerKey(layer)}`; }
function providerInteractiveLayerIds(layer: PreviewLayer): string[] { const id = providerLayerId(layer); return [id, `${id}-medium`, `${id}-low`, `${id}-fill`, `${id}-outline`]; }
function providerSourceId(archiveUrl: string): string { return `${PROVIDER_PREFIX}archive:${archiveUrl.replace(/[^a-z0-9]/gi, "_")}`; }
function wmsTileUrl(endpoint: string, wmsLayer: string, format: string): string {
  const parameters = new URLSearchParams({
    SERVICE: "WMS", VERSION: "1.3.0", REQUEST: "GetMap", LAYERS: wmsLayer, STYLES: "default",
    FORMAT: format, TRANSPARENT: "TRUE", CRS: "EPSG:3857", WIDTH: "256", HEIGHT: "256", BBOX: "{bbox-epsg-3857}",
  });
  return `${endpoint}?${parameters.toString().replace("%7Bbbox-epsg-3857%7D", "{bbox-epsg-3857}")}`;
}

export function MapView({ layers, transportRoadClasses, references, orthophotoEnabled, basemapEnabled, aoiOutline, selected, selectedDetail, selectedCircuit, onSelectFeature }: { layers: PreviewLayer[]; transportRoadClasses: Record<TransportRoadClass, boolean>; references: KiutReferenceLayer[]; orthophotoEnabled: boolean; basemapEnabled: boolean; aoiOutline: Geometry | null; selected: SelectedProviderFeature | null; selectedDetail: MapFeatureDetail | null; selectedCircuit: MapCircuit | null; onSelectFeature: (selected: SelectedProviderFeature) => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const layersRef = useRef(layers);
  const onSelectFeatureRef = useRef(onSelectFeature);
  const fittedArchiveRef = useRef<string | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [currentZoom, setCurrentZoom] = useState(9);

  useEffect(() => { layersRef.current = layers; }, [layers]);
  useEffect(() => { onSelectFeatureRef.current = onSelectFeature; }, [onSelectFeature]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      center: [18.546285, 50.102174],
      zoom: 9,
      style: { version: 8, sources: {}, layers: [{ id: "background", type: "background", paint: { "background-color": "#0b1728" } }] },
    });
    mapRef.current = map;
    map.once("load", () => setMapReady(true));
    map.on("zoom", () => setCurrentZoom(map.getZoom()));
    map.on("click", (event) => {
      const visibleIds = layersRef.current.flatMap(providerInteractiveLayerIds).filter((id) => map.getLayer(id));
      const rendered = map.queryRenderedFeatures(event.point, { layers: visibleIds })[0];
      if (!rendered) return;
      const layer = layersRef.current.find((candidate) => candidate.artifact.source_layer === rendered.sourceLayer);
      if (!layer) return;
      const feature = asProviderFeature(rendered);
      onSelectFeatureRef.current({ layer, feature });
      popupRef.current?.remove();
      popupRef.current = new maplibregl.Popup({ closeButton: true, offset: 10 }).setLngLat(event.lngLat).setDOMContent(featurePopupContent(feature, layer)).addTo(map);
    });
    map.on("mousemove", (event) => {
      const visibleIds = layersRef.current.flatMap(providerInteractiveLayerIds).filter((id) => map.getLayer(id));
      map.getCanvas().style.cursor = visibleIds.length && map.queryRenderedFeatures(event.point, { layers: visibleIds }).length ? "pointer" : "";
    });
    return () => { popupRef.current?.remove(); map.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (map.getLayer(BASEMAP_SOURCE_ID)) map.removeLayer(BASEMAP_SOURCE_ID);
    if (map.getSource(BASEMAP_SOURCE_ID)) map.removeSource(BASEMAP_SOURCE_ID);
    if (!basemapEnabled) return;
    map.addSource(BASEMAP_SOURCE_ID, {
      type: "raster",
      tiles: [openStreetMapBasemap.tileUrlTemplate],
      tileSize: 256,
      attribution: openStreetMapBasemap.attribution,
      minzoom: openStreetMapBasemap.minZoom,
      maxzoom: openStreetMapBasemap.maxZoom,
    });
    map.addLayer({ id: BASEMAP_SOURCE_ID, type: "raster", source: BASEMAP_SOURCE_ID, paint: { "raster-opacity": 0.86 } });
  }, [basemapEnabled, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    removePrefixedLayersAndSources(map, PROVIDER_PREFIX);
    const archives = new Map<string, PreviewLayer[]>();
    layers.forEach((layer) => archives.set(layer.archiveUrl, [...(archives.get(layer.archiveUrl) ?? []), layer]));
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
        const color = presentationColor(index);
        const isLine = isLinePresentationLayer(layer.artifact.source_layer);
        if (isLine) {
          if (layer.artifact.artifact_id === "transport.roads") {
            const enabledRoadClasses = Object.entries(transportRoadClasses).filter(([, enabled]) => enabled).map(([roadClass]) => roadClass);
            map.addLayer({ id, type: "line", source: sourceId, "source-layer": layer.artifact.source_layer, minzoom: 11, filter: ["in", ["get", "road_class"], ["literal", enabledRoadClasses]], paint: { "line-color": roadLineColor, "line-width": 4, "line-opacity": 0.9 } });
          } else if (layer.artifact.artifact_id === "transport.railways") {
            map.addLayer({ id, type: "line", source: sourceId, "source-layer": layer.artifact.source_layer, minzoom: 11, paint: { "line-color": "#cbd5e1", "line-width": 3.5, "line-dasharray": [3, 2], "line-opacity": 0.9 } });
          } else {
            const base = { type: "line" as const, source: sourceId, "source-layer": layer.artifact.source_layer, paint: { "line-color": voltageLineColor, "line-width": 4.5, "line-opacity": 0.9 } };
            map.addLayer({ ...base, id, filter: ["all", ["!=", ["get", "voltage_bucket"], "medium"], ["!=", ["get", "voltage_bucket"], "low"]] });
            map.addLayer({ ...base, id: `${id}-medium`, minzoom: 11, filter: ["==", ["get", "voltage_bucket"], "medium"] });
            map.addLayer({ ...base, id: `${id}-low`, minzoom: 13, filter: ["==", ["get", "voltage_bucket"], "low"] });
            map.addLayer({ id: `${id}-labels`, type: "symbol", source: sourceId, "source-layer": layer.artifact.source_layer, minzoom: 12, filter: ["all", ["!=", ["get", "voltage_bucket"], "medium"], ["!=", ["get", "voltage_bucket"], "low"]], layout: { "symbol-placement": "line", "text-field": ["coalesce", ["get", "voltage_label"], ["get", "name"]], "text-size": 11, "text-max-angle": 35 }, paint: { "text-color": "#f8fafc", "text-halo-color": "#0f172a", "text-halo-width": 1.5 } });
          }
        } else {
          const minzoom = layer.domain === "emergency" ? 7 : 12;
          const emergencyColor = ["match", ["get", "asset_type"], "hospital", "#e11d48", "fire_service", "#f97316", "police", "#2563eb", "ambulance_rescue", "#eab308", color] as ExpressionSpecification;
          const supportPaint: CircleLayerSpecification["paint"] = { "circle-color": ["match", ["get", "asset_type"], "tower", "#f97316", "portal", "#facc15", "utility_pole", "#38bdf8", "#cbd5e1"] as ExpressionSpecification, "circle-radius": ["match", ["get", "asset_type"], "tower", 5, "portal", 4.5, "utility_pole", 3.5, 3] as ExpressionSpecification, "circle-stroke-width": 1.25, "circle-stroke-color": "#07111f", "circle-opacity": 0.9 };
          const pointPaint: CircleLayerSpecification["paint"] = layer.artifact.artifact_id === "power.supports"
            ? supportPaint
            : { "circle-color": emergencyColor, "circle-radius": layer.domain === "emergency" ? 7 : 6, "circle-stroke-width": 1.25, "circle-stroke-color": "#07111f", "circle-opacity": 0.9 };
          map.addLayer({ id: `${id}-fill`, type: "fill", source: sourceId, "source-layer": layer.artifact.source_layer, minzoom, filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": emergencyColor, "fill-opacity": 0.3 } });
          map.addLayer({ id: `${id}-outline`, type: "line", source: sourceId, "source-layer": layer.artifact.source_layer, minzoom, filter: ["==", ["geometry-type"], "Polygon"], paint: { "line-color": emergencyColor, "line-width": 2.5, "line-opacity": 0.95 } });
          map.addLayer({ id, type: "circle", source: sourceId, "source-layer": layer.artifact.source_layer, minzoom, filter: ["==", ["geometry-type"], "Point"], paint: pointPaint });
        }
      });
      const bounds = archiveLayers[0]?.archiveBounds;
      if (bounds && fittedArchiveRef.current !== archiveUrl) {
        map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: 28, maxZoom: 10 });
        fittedArchiveRef.current = archiveUrl;
      }
    });
  }, [layers, mapReady, transportRoadClasses]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    removePrefixedLayersAndSources(map, REFERENCE_PREFIX);
    if (orthophotoEnabled) addRasterReference(map, "orthophoto", ORTHOPHOTO_WMS_URL, orthophotoReference.wmsLayer, "image/jpeg", orthophotoReference.attribution, 0, 20);
    references.forEach((reference) => addRasterReference(map, reference.id, KIUT_WMS_URL, reference.wmsLayer, "image/png", "GUGiK, KIUT/GESUT WMS", KIUT_MIN_ZOOM, KIUT_MAX_ZOOM));
    if (references.length && map.getZoom() < KIUT_MIN_ZOOM) map.setZoom(KIUT_MIN_ZOOM);
  }, [references, orthophotoEnabled, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (map.getLayer(AOI_OUTLINE_LINE_ID)) map.removeLayer(AOI_OUTLINE_LINE_ID);
    if (map.getLayer(AOI_OUTLINE_FILL_ID)) map.removeLayer(AOI_OUTLINE_FILL_ID);
    if (map.getSource(AOI_OUTLINE_SOURCE_ID)) map.removeSource(AOI_OUTLINE_SOURCE_ID);
    if (!aoiOutline || !["Polygon", "MultiPolygon"].includes(aoiOutline.type)) return;
    map.addSource(AOI_OUTLINE_SOURCE_ID, { type: "geojson", data: { type: "Feature", properties: {}, geometry: aoiOutline } });
    map.addLayer({ id: AOI_OUTLINE_FILL_ID, type: "fill", source: AOI_OUTLINE_SOURCE_ID, paint: { "fill-color": "#38bdf8", "fill-opacity": 0.11 } });
    map.addLayer({ id: AOI_OUTLINE_LINE_ID, type: "line", source: AOI_OUTLINE_SOURCE_ID, paint: { "line-color": "#38bdf8", "line-width": 2.5, "line-dasharray": [2, 1] } });
  }, [aoiOutline, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (map.getLayer(CIRCUIT_ENDPOINT_ID)) map.removeLayer(CIRCUIT_ENDPOINT_ID);
    if (map.getLayer(CIRCUIT_LINE_ID)) map.removeLayer(CIRCUIT_LINE_ID);
    if (map.getSource(CIRCUIT_SOURCE_ID)) map.removeSource(CIRCUIT_SOURCE_ID);
    if (!selectedCircuit) return;
    const members = selectedCircuit.members.filter((member) => member.geometry);
    const lines = members.map((member) => ({ type: "Feature" as const, properties: { source_id: member.source_id, role: member.role }, geometry: member.geometry! }));
    const endpoints = members.flatMap((member) => {
      const coordinates = member.geometry!.coordinates;
      return [coordinates[0], coordinates.at(-1)!].map((coordinate) => ({ type: "Feature" as const, properties: { source_id: member.source_id }, geometry: { type: "Point" as const, coordinates: coordinate } }));
    });
    map.addSource(CIRCUIT_SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features: [...lines, ...endpoints] } });
    map.addLayer({ id: CIRCUIT_LINE_ID, type: "line", source: CIRCUIT_SOURCE_ID, filter: ["==", ["geometry-type"], "LineString"], paint: { "line-color": "#facc15", "line-width": 8, "line-opacity": 0.88, "line-blur": 0.35 } });
    map.addLayer({ id: CIRCUIT_ENDPOINT_ID, type: "circle", source: CIRCUIT_SOURCE_ID, filter: ["==", ["geometry-type"], "Point"], paint: { "circle-color": "#facc15", "circle-radius": 5, "circle-stroke-color": "#7c2d12", "circle-stroke-width": 2 } });
  }, [mapReady, selectedCircuit]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (map.getLayer(SELECTED_FEATURE_ENDPOINT_ID)) map.removeLayer(SELECTED_FEATURE_ENDPOINT_ID);
    if (map.getLayer(SELECTED_FEATURE_LINE_ID)) map.removeLayer(SELECTED_FEATURE_LINE_ID);
    if (map.getSource(SELECTED_FEATURE_SOURCE_ID)) map.removeSource(SELECTED_FEATURE_SOURCE_ID);
    const detail = selectedDetail?.source_id === selected?.feature.properties.source_id ? selectedDetail : null;
    const feature = detail ? detail.feature : selected?.feature;
    if (!feature?.geometry || (feature.geometry.type !== "LineString" && feature.geometry.type !== "MultiLineString")) return;
    const features: Array<{ type: "Feature"; properties: Record<string, unknown>; geometry: Geometry }> = [{ type: "Feature", properties: {}, geometry: feature.geometry }];
    if (feature.geometry.type === "LineString") {
      const coords = feature.geometry.coordinates;
      if (coords.length > 0) {
        features.push({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: coords[0] } });
        features.push({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: coords[coords.length - 1] } });
      }
    }
    map.addSource(SELECTED_FEATURE_SOURCE_ID, { type: "geojson", data: { type: "FeatureCollection", features } });
    map.addLayer({ id: SELECTED_FEATURE_LINE_ID, type: "line", source: SELECTED_FEATURE_SOURCE_ID, filter: ["in", ["geometry-type"], ["literal", ["LineString", "MultiLineString"]]], paint: { "line-color": "#38bdf8", "line-width": 6.5, "line-opacity": 0.95 } });
    map.addLayer({ id: SELECTED_FEATURE_ENDPOINT_ID, type: "circle", source: SELECTED_FEATURE_SOURCE_ID, filter: ["==", ["geometry-type"], "Point"], paint: { "circle-color": "#38bdf8", "circle-radius": 5.5, "circle-stroke-color": "#07111f", "circle-stroke-width": 2 } });
  }, [mapReady, selected, selectedDetail]);

  useEffect(() => {
    if (!popupRef.current || !selected) return;
    const detail = selectedDetail?.source_id === selected.feature.properties.source_id ? selectedDetail : null;
    const feature = detail ? detail.feature : selected.feature;
    popupRef.current.setDOMContent(featurePopupContent(feature, selected.layer));
  }, [selected, selectedDetail]);

  const hasTransportLayers = layers.some((layer) => layer.domain === "transport");

  return (
    <div className="mapPanel">
      {hasTransportLayers && currentZoom < 11 && (
        <div className="zoomGuidanceBanner">
          Zoom in (level 11+) to inspect transport road and railway network features.
        </div>
      )}
      <div className="map" ref={containerRef} />
    </div>
  );
}

function featurePopupContent(feature: ProviderFeature, layer: PreviewLayer): HTMLElement {
  const details = popupDetails(feature, layer); const properties = feature.properties;
  const tags = { ...asStringRecord(properties.osm_tags), ...asStringRecord(properties.source_attributes) };
  const sourceId = typeof properties.source_id === "string" ? properties.source_id : "";
  const sourceLink = /^((node|way|relation)\/\d+)$/.test(sourceId) ? `https://www.openstreetmap.org/${sourceId}` : null;
  const links = [sourceLink ? `<a href="${sourceLink}" target="_blank" rel="noreferrer">OpenStreetMap object</a>` : "", externalLink(tags.website, "website"), wikipediaLink(tags.wikipedia), wikidataLink(tags.wikidata), externalLink(tags.image, "source image")].filter(Boolean).join(" · ");
  const fields = ["power", "man_made", "amenity", "healthcare", "emergency", "highway", "railway", "aeroway", "road_class", "ref", "surface", "maxspeed", "lanes", "bridge", "tunnel", "oneway", "official_type", "iip_identifier", "jpt_id", "version_from", "voltage", "frequency", "operator", "circuits", "cables", "wires", "plant:source", "plant:method", "plant:output:electricity", "start_date", "description", "phone", "contact:phone", "opening_hours", "wheelchair"]
    .filter((name) => tags[name] || (name === "road_class" && typeof properties.road_class === "string"))
    .map((name) => `<dt>${escapeHtml(name)}</dt><dd>${escapeHtml(String(tags[name] ?? properties[name] ?? ""))}</dd>`).join("");
  const content = document.createElement("div"); content.className = "mapFeaturePopup";
  const roadClass = typeof properties.road_class === "string" ? properties.road_class : tags.highway;
  const classification = properties.domain === "power"
    ? String(properties.voltage_label ?? tags.voltage ?? "voltage unknown")
    : properties.domain === "transport" && roadClass
      ? `road (${roadClass})`
      : String(properties.asset_type ?? "feature").replaceAll("_", " ");
  content.innerHTML = `<strong>${escapeHtml(String(properties.name ?? tags.name ?? details.title))}</strong><span>${escapeHtml(classification)} · ${escapeHtml(String(tags.operator ?? details.source))}</span>${fields ? `<dl>${fields}</dl>` : ""}<small>${escapeHtml(sourceId)}</small>${links ? `<small class="popupLinks">${links}</small>` : ""}`;
  return content;
}
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[character] ?? character); }
function asStringRecord(value: unknown): Record<string, string> { return value && typeof value === "object" ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string")) : {}; }
function externalLink(value: string | undefined, label: string): string {
  if (!value) return "";
  try { const url = new URL(value); return url.protocol === "https:" || url.protocol === "http:" ? `<a href="${escapeHtml(url.toString())}" target="_blank" rel="noreferrer">${label}</a>` : ""; } catch { return ""; }
}
function wikipediaLink(value: string | undefined): string {
  if (!value) return "";
  const [language, ...title] = value.split(":");
  if (!/^[a-z-]{2,12}$/i.test(language) || !title.join(":")) return "";
  return `<a href="https://${language}.wikipedia.org/wiki/${encodeURIComponent(title.join(":"))}" target="_blank" rel="noreferrer">Wikipedia</a>`;
}
function wikidataLink(value: string | undefined): string {
  return value && /^Q\d+$/.test(value) ? `<a href="https://www.wikidata.org/wiki/${value}" target="_blank" rel="noreferrer">Wikidata</a>` : "";
}

function asProviderFeature(feature: MapGeoJSONFeature): ProviderFeature {
  return { type: "Feature", properties: feature.properties ?? {}, geometry: feature.geometry as Geometry };
}

function addRasterReference(map: maplibregl.Map, key: string, endpoint: string, wmsLayer: string, format: string, attribution: string, minzoom: number, maxzoom: number): void {
  const sourceId = `${REFERENCE_PREFIX}${key}`;
  map.addSource(sourceId, { type: "raster", tiles: [wmsTileUrl(endpoint, wmsLayer, format)], tileSize: 256, attribution, minzoom, maxzoom });
  // Reference imagery stays below public analytical vectors. KIUT remains above
  // orthophoto because each subsequent raster is inserted immediately before
  // the first provider layer.
  map.addLayer(
    { id: sourceId, type: "raster", source: sourceId, minzoom, maxzoom, paint: { "raster-opacity": key === "orthophoto" ? 0.8 : 0.72 } },
    referenceRasterInsertionPoint(map.getStyle().layers?.map((layer) => layer.id) ?? []),
  );
}

function removePrefixedLayersAndSources(map: maplibregl.Map, prefix: string): void {
  map.getStyle().layers?.filter((layer) => layer.id.startsWith(prefix)).forEach((layer) => map.removeLayer(layer.id));
  Object.keys(map.getStyle().sources).filter((sourceId) => sourceId.startsWith(prefix)).forEach((sourceId) => map.removeSource(sourceId));
}
