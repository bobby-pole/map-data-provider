import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { popupDetails, type PreviewLayer } from "../previewCatalog";
import type { ProviderFeature } from "../types/api";
import type { SelectedProviderFeature } from "../inspection";
import { KIUT_MAX_ZOOM, KIUT_MIN_ZOOM, KIUT_WMS_URL, type KiutReferenceLayer } from "../kiutReference";
import { ORTHOPHOTO_WMS_URL, orthophotoReference } from "../orthophotoReference";

function escapeHtml(value: string): string { return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character); }
function popup(feature: ProviderFeature, layer: PreviewLayer): string {
  const details = popupDetails(feature, layer);
  return `<strong>${escapeHtml(details.title)}</strong><br/>Source: ${escapeHtml(details.source)}<br/>Confidence: ${escapeHtml(details.confidence)}<br/>Readiness: ${escapeHtml(details.readiness)}<br/>Limitations: ${escapeHtml(details.limitations.join("; ") || "none")}`;
}

export function MapView({ layers, references, orthophotoEnabled, onSelectFeature }: { layers: PreviewLayer[]; references: KiutReferenceLayer[]; orthophotoEnabled: boolean; onSelectFeature: (selected: SelectedProviderFeature) => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const providerLayerRef = useRef<L.FeatureGroup | null>(null);
  const referenceLayerRef = useRef<L.LayerGroup | null>(null);
  const orthophotoLayerRef = useRef<L.TileLayer.WMS | null>(null);
  const onSelectFeatureRef = useRef(onSelectFeature);
  useEffect(() => { onSelectFeatureRef.current = onSelectFeature; }, [onSelectFeature]);
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current).setView([50.102174, 18.546285], 10); mapRef.current = map;
    map.createPane("orthophotoReferencePane").style.zIndex = "250";
    map.createPane("kiutReferencePane").style.zIndex = "350";
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors", maxZoom: KIUT_MAX_ZOOM, maxNativeZoom: 19,
    }).addTo(map);
    return () => { map.remove(); mapRef.current = null; };
  }, []);
  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    providerLayerRef.current?.remove();
    const group = L.featureGroup().addTo(map);
    const colors = ["#f59e0b", "#38bdf8", "#a78bfa", "#34d399"];
    layers.forEach((layer, index) => {
      L.geoJSON(layer.layer as GeoJSON.GeoJsonObject, {
        style: { color: colors[index % colors.length], weight: 2, opacity: 0.85 },
        onEachFeature: (feature, leafletLayer) => {
          const providerFeature = feature as ProviderFeature;
          leafletLayer.bindPopup(popup(providerFeature, layer));
          leafletLayer.on("click", () => onSelectFeatureRef.current({ feature: providerFeature, layer }));
        },
      }).addTo(group);
    });
    providerLayerRef.current = group;
    const bounds = group.getBounds(); if (bounds.isValid()) map.fitBounds(bounds, { padding: [20, 20] });
    return () => { group.remove(); };
  }, [layers]);
  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    referenceLayerRef.current?.remove();
    if (references.length && map.getZoom() < KIUT_MIN_ZOOM) map.setZoom(KIUT_MIN_ZOOM);
    const group = L.layerGroup().addTo(map);
    references.forEach((reference) => L.tileLayer.wms(KIUT_WMS_URL, {
      layers: reference.wmsLayer, styles: "default", format: "image/png", transparent: true,
      version: "1.3.0", attribution: "GUGiK, KIUT/GESUT WMS", pane: "kiutReferencePane",
      minZoom: KIUT_MIN_ZOOM, maxZoom: KIUT_MAX_ZOOM,
    }).addTo(group));
    referenceLayerRef.current = group;
    return () => { group.remove(); };
  }, [references]);
  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    orthophotoLayerRef.current?.remove();
    if (!orthophotoEnabled) return;
    const layer = L.tileLayer.wms(ORTHOPHOTO_WMS_URL, {
      layers: orthophotoReference.wmsLayer, styles: "", format: "image/jpeg", transparent: false,
      version: "1.3.0", attribution: orthophotoReference.attribution, pane: "orthophotoReferencePane", maxZoom: 20,
    }).addTo(map);
    orthophotoLayerRef.current = layer;
    return () => { layer.remove(); };
  }, [orthophotoEnabled]);
  return <div className="map" ref={containerRef} />;
}
