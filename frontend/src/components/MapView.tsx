import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { popupDetails, type PreviewLayer } from "../previewCatalog";
import type { ProviderFeature } from "../types/api";

function escapeHtml(value: string): string { return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character); }
function popup(feature: ProviderFeature, layer: PreviewLayer): string {
  const details = popupDetails(feature, layer);
  return `<strong>${escapeHtml(details.title)}</strong><br/>Source: ${escapeHtml(details.source)}<br/>Confidence: ${escapeHtml(details.confidence)}<br/>Readiness: ${escapeHtml(details.readiness)}<br/>Limitations: ${escapeHtml(details.limitations.join("; ") || "none")}`;
}

export function MapView({ layers }: { layers: PreviewLayer[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const providerLayerRef = useRef<L.FeatureGroup | null>(null);
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current).setView([50.102174, 18.546285], 10); mapRef.current = map;
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap contributors", maxZoom: 19 }).addTo(map);
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
        onEachFeature: (feature, leafletLayer) => leafletLayer.bindPopup(popup(feature as ProviderFeature, layer)),
      }).addTo(group);
    });
    providerLayerRef.current = group;
    const bounds = group.getBounds(); if (bounds.isValid()) map.fitBounds(bounds, { padding: [20, 20] });
    return () => { group.remove(); };
  }, [layers]);
  return <div className="map" ref={containerRef} />;
}
