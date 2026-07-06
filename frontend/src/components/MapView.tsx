import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

const API_BASE = "http://localhost:8000";

export function MapView() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current).setView([50.102174, 18.546285], 10);
    mapRef.current = map;

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© OpenStreetMap contributors",
      maxZoom: 19,
    }).addTo(map);

    const lineLayer = L.geoJSON(undefined, {
      style: { color: "#f59e0b", weight: 2, opacity: 0.85 },
      onEachFeature: (feature, layer) => {
        const props = feature.properties ?? {};
        layer.bindPopup(`<strong>Power line</strong><br/>OSM id: ${props.id ?? "unknown"}<br/>Voltage: ${props.voltage ?? "missing"}`);
      },
    }).addTo(map);

    const nodeLayer = L.geoJSON(undefined, {
      pointToLayer: (_feature, latlng) => L.circleMarker(latlng, {
        radius: 5,
        color: "#38bdf8",
        fillColor: "#38bdf8",
        fillOpacity: 0.8,
        weight: 1,
      }),
      onEachFeature: (feature, layer) => {
        const props = feature.properties ?? {};
        layer.bindPopup(`<strong>${props.ss_power_label ?? "Power node"}</strong><br/>OSM id: ${props.id ?? "unknown"}<br/>Source: OSM`);
      },
    }).addTo(map);

    void fetch(`${API_BASE}/api/geodata/power/lines`).then((r) => r.json()).then((data) => lineLayer.addData(data));
    void fetch(`${API_BASE}/api/geodata/power/nodes`).then((r) => r.json()).then((data) => nodeLayer.addData(data));

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  return <div className="map" ref={containerRef} />;
}
