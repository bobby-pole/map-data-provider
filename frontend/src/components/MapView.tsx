import { useEffect, useRef, useState } from "react";
import maplibregl, { type MapGeoJSONFeature } from "maplibre-gl";
import type { Geometry } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
import { Protocol } from "pmtiles";

import { popupDetails, previewLayerKey, type PreviewLayer } from "../previewCatalog";
import type { ProviderFeature } from "../types/api";
import type { SelectedProviderFeature } from "../inspection";
import { KIUT_MAX_ZOOM, KIUT_MIN_ZOOM, KIUT_WMS_URL, type KiutReferenceLayer } from "../kiutReference";
import { ORTHOPHOTO_WMS_URL, orthophotoReference } from "../orthophotoReference";
import { isLinePresentationLayer, openStreetMapBasemap, presentationColor } from "../mapStyle";

const pmtilesProtocol = new Protocol();
maplibregl.addProtocol("pmtiles", pmtilesProtocol.tile);

const PROVIDER_PREFIX = "provider:";
const REFERENCE_PREFIX = "reference:";
const BASEMAP_SOURCE_ID = "basemap:openstreetmap";

function providerLayerId(layer: PreviewLayer): string { return `${PROVIDER_PREFIX}${previewLayerKey(layer)}`; }
function providerSourceId(archiveUrl: string): string { return `${PROVIDER_PREFIX}archive:${archiveUrl.replace(/[^a-z0-9]/gi, "_")}`; }
function wmsTileUrl(endpoint: string, wmsLayer: string, format: string): string {
  const parameters = new URLSearchParams({
    SERVICE: "WMS", VERSION: "1.3.0", REQUEST: "GetMap", LAYERS: wmsLayer, STYLES: "default",
    FORMAT: format, TRANSPARENT: "TRUE", CRS: "EPSG:3857", WIDTH: "256", HEIGHT: "256", BBOX: "{bbox-epsg-3857}",
  });
  return `${endpoint}?${parameters.toString().replace("%7Bbbox-epsg-3857%7D", "{bbox-epsg-3857}")}`;
}

export function MapView({ layers, references, orthophotoEnabled, basemapEnabled, onSelectFeature }: { layers: PreviewLayer[]; references: KiutReferenceLayer[]; orthophotoEnabled: boolean; basemapEnabled: boolean; onSelectFeature: (selected: SelectedProviderFeature) => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const layersRef = useRef(layers);
  const onSelectFeatureRef = useRef(onSelectFeature);
  const fittedArchiveRef = useRef<string | null>(null);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const [mapReady, setMapReady] = useState(false);

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
    map.on("click", (event) => {
      const visibleIds = layersRef.current.map(providerLayerId).filter((id) => map.getLayer(id));
      const rendered = map.queryRenderedFeatures(event.point, { layers: visibleIds })[0];
      if (!rendered) return;
      const layer = layersRef.current.find((candidate) => candidate.artifact.source_layer === rendered.sourceLayer);
      if (!layer) return;
      const feature = asProviderFeature(rendered);
      onSelectFeatureRef.current({ layer, feature });
      popupRef.current?.remove();
      popupRef.current = new maplibregl.Popup({ closeButton: true, closeOnClick: false, offset: 10 })
        .setLngLat(event.lngLat)
        .setDOMContent(featurePopupContent(feature, layer))
        .addTo(map);
    });
    map.on("mousemove", (event) => {
      const visibleIds = layersRef.current.map(providerLayerId).filter((id) => map.getLayer(id));
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
    popupRef.current?.remove();
    popupRef.current = null;
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
        map.addLayer(isLine ? {
          id, type: "line", source: sourceId, "source-layer": layer.artifact.source_layer,
          paint: { "line-color": color, "line-width": 4.5, "line-opacity": 0.9 },
        } : {
          id, type: "circle", source: sourceId, "source-layer": layer.artifact.source_layer,
          paint: { "circle-color": color, "circle-radius": 6, "circle-stroke-width": 1.25, "circle-stroke-color": "#07111f", "circle-opacity": 0.9 },
        });
      });
      const bounds = archiveLayers[0]?.archiveBounds;
      if (bounds && fittedArchiveRef.current !== archiveUrl) {
        map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]], { padding: 28, maxZoom: 10 });
        fittedArchiveRef.current = archiveUrl;
      }
    });
  }, [layers, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    removePrefixedLayersAndSources(map, REFERENCE_PREFIX);
    if (orthophotoEnabled) addRasterReference(map, "orthophoto", ORTHOPHOTO_WMS_URL, orthophotoReference.wmsLayer, "image/jpeg", orthophotoReference.attribution, 0, 20);
    references.forEach((reference) => addRasterReference(map, reference.id, KIUT_WMS_URL, reference.wmsLayer, "image/png", "GUGiK, KIUT/GESUT WMS", KIUT_MIN_ZOOM, KIUT_MAX_ZOOM));
    if (references.length && map.getZoom() < KIUT_MIN_ZOOM) map.setZoom(KIUT_MIN_ZOOM);
  }, [references, orthophotoEnabled, mapReady]);

  return <div className="map" ref={containerRef} />;
}

function asProviderFeature(feature: MapGeoJSONFeature): ProviderFeature {
  return { type: "Feature", properties: feature.properties ?? {}, geometry: feature.geometry as Geometry };
}

function featurePopupContent(feature: ProviderFeature, layer: PreviewLayer): HTMLElement {
  const details = popupDetails(feature, layer);
  const content = document.createElement("div");
  content.className = "mapFeaturePopup";
  const title = document.createElement("strong");
  title.textContent = details.title;
  const source = document.createElement("span");
  source.textContent = `${details.source} · ${details.confidence}`;
  const hint = document.createElement("small");
  hint.textContent = "Full provider evidence is in the Selected feature panel.";
  content.append(title, source, hint);
  return content;
}

function addRasterReference(map: maplibregl.Map, key: string, endpoint: string, wmsLayer: string, format: string, attribution: string, minzoom: number, maxzoom: number): void {
  const sourceId = `${REFERENCE_PREFIX}${key}`;
  map.addSource(sourceId, { type: "raster", tiles: [wmsTileUrl(endpoint, wmsLayer, format)], tileSize: 256, attribution, minzoom, maxzoom });
  map.addLayer({ id: sourceId, type: "raster", source: sourceId, minzoom, maxzoom, paint: { "raster-opacity": key === "orthophoto" ? 0.8 : 0.72 } });
}

function removePrefixedLayersAndSources(map: maplibregl.Map, prefix: string): void {
  map.getStyle().layers?.filter((layer) => layer.id.startsWith(prefix)).forEach((layer) => map.removeLayer(layer.id));
  Object.keys(map.getStyle().sources).filter((sourceId) => sourceId.startsWith(prefix)).forEach((sourceId) => map.removeSource(sourceId));
}
