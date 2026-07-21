import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import type { CachedLayer, ProviderFeature } from "../types/api";

function escapeHtml(value: string): string { return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character); }
function popup(feature: ProviderFeature): string {
  const props = feature.properties;
  return `<strong>${escapeHtml(props.asset_type)}</strong><br/>Source: ${escapeHtml(props.source)}<br/>Confidence: ${escapeHtml(props.confidence)}<br/>Missing fields: ${escapeHtml(props.missing_fields.join(", ") || "none")}<br/>Limitations: ${escapeHtml(props.limitations.join("; ") || "none")}`;
}

export function MapView({ layer }: { layer: CachedLayer | null }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const providerLayerRef = useRef<L.GeoJSON | null>(null);
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current).setView([50.102174, 18.546285], 10); mapRef.current = map;
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap contributors", maxZoom: 19 }).addTo(map);
    return () => { map.remove(); mapRef.current = null; };
  }, []);
  useEffect(() => {
    const map = mapRef.current; if (!map || !layer) return;
    providerLayerRef.current?.remove();
    const geoJson = L.geoJSON(layer as GeoJSON.GeoJsonObject, { style: { color: "#f59e0b", weight: 2, opacity: 0.85 }, onEachFeature: (feature, leafletLayer) => leafletLayer.bindPopup(popup(feature as ProviderFeature)) }).addTo(map);
    providerLayerRef.current = geoJson;
    const bounds = geoJson.getBounds(); if (bounds.isValid()) map.fitBounds(bounds, { padding: [20, 20] });
    return () => { geoJson.remove(); };
  }, [layer]);
  return <div className="map" ref={containerRef} />;
}
