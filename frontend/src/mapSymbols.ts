import type { ExpressionSpecification } from "maplibre-gl";

import type { PreviewLayer } from "./previewCatalog";

export type MapSymbolKind =
  | "power-substation" | "power-transformer" | "power-plant" | "power-generator" | "power-switchgear" | "power-tower" | "power-portal" | "power-pole"
  | "hospital" | "fire-station" | "police" | "ambulance"
  | "townhall" | "school" | "post-office" | "library"
  | "rail-station" | "aviation" | "crossing"
  | "water-facility" | "gas-facility" | "sewer-facility" | "telecom-tower" | "telecom-facility" | "heat-facility"
  | "industrial" | "military" | "generic";

export type SymbolLegendItem = { kind: MapSymbolKind; label: string };

const SYMBOL_SIZE = 48;
const iconKinds: readonly MapSymbolKind[] = [
  "power-substation", "power-transformer", "power-plant", "power-generator", "power-switchgear", "power-tower", "power-portal", "power-pole",
  "hospital", "fire-station", "police", "ambulance",
  "townhall", "school", "post-office", "library",
  "rail-station", "aviation", "crossing",
  "water-facility", "gas-facility", "sewer-facility", "telecom-tower", "telecom-facility", "heat-facility",
  "industrial", "military", "generic",
];

const symbolDefinitions: Record<MapSymbolKind, { color: string; path: string }> = {
  "power-substation": { color: "#facc15", path: "M12 4 5 12h5l-2 8 9-11h-5l2-5Z" },
  "power-transformer": { color: "#fde047", path: "M5 8h14v8H5Zm4 2v4m3-4v4m3-4v4M3 12h2m14 0h2" },
  "power-plant": { color: "#eab308", path: "M4 20V10l6 3V8l5 3V5l4 2v13H4Zm4-3h2m3 0h2m3 0h1" },
  "power-generator": { color: "#f59e0b", path: "M12 4a8 8 0 1 1-5.7 2.3M12 8v4l3 2M5 5l3 3" },
  "power-switchgear": { color: "#fbbf24", path: "M4 12h5l3-5 3 10 2-5h3M5 5v4m14-4v4" },
  "power-tower": { color: "#f97316", path: "M12 3 7 21m5-18 5 18M5 11h14M7 16h10M9 21h6" },
  "power-portal": { color: "#eab308", path: "M5 20V8l7-4 7 4v12M5 13h14M12 4v16" },
  "power-pole": { color: "#38bdf8", path: "M12 3v18M5 7h14M8 7l-2 5m10-5 2 5M8 21h8" },
  hospital: { color: "#e11d48", path: "M10 5h4v5h5v4h-5v5h-4v-5H5v-4h5Z" },
  "fire-station": { color: "#fb923c", path: "M12 3c2 4 5 5 5 10a5 5 0 1 1-10 0c0-3 2-5 3-7 0 3 2 3 2-3Zm0 9c-1 1-2 2-2 3a2 2 0 0 0 4 0c0-1-1-2-2-3Z" },
  police: { color: "#2563eb", path: "M12 3 19 6v5c0 5-3 8-7 10-4-2-7-5-7-10V6l7-3Zm0 5v7m-3-3h6" },
  ambulance: { color: "#f43f5e", path: "M5 8h9v8H5Zm9 3h3l2 2v3h-5Zm-6-1h3v4H8Zm8 5h2" },
  townhall: { color: "#0ea5e9", path: "M4 10 12 5l8 5M6 11v7m4-7v7m4-7v7m4-7v7M4 20h16" },
  school: { color: "#6366f1", path: "M3 10 12 5l9 5-9 5-9-5Zm4 3v4c3 2 7 2 10 0v-4M12 15v4" },
  "post-office": { color: "#f59e0b", path: "M4 7h16v11H4Zm0 1 8 6 8-6" },
  library: { color: "#a78bfa", path: "M5 5h5v14H5Zm5 1h5v13h-5Zm5-1h4v14h-4" },
  "rail-station": { color: "#8b5cf6", path: "M7 4h10v12a3 3 0 0 1-3 3H10a3 3 0 0 1-3-3V4Zm3 3h4M9 11h1m4 0h1M9 19l-2 2m8-2 2 2" },
  aviation: { color: "#38bdf8", path: "M12 3v18m0-13 7 4v2l-7-2-7 2v-2l7-4Zm0 5-4 5h8l-4-5" },
  crossing: { color: "#f59e0b", path: "M5 5 19 19M19 5 5 19M8 8l8 8m0-8-8 8" },
  "water-facility": { color: "#06b6d4", path: "M12 3c4 5 6 8 6 11a6 6 0 0 1-12 0c0-3 2-6 6-11Zm-3 12c1 2 5 2 6-1" },
  "gas-facility": { color: "#fb923c", path: "M8 5h8v14H8Zm2 3h4m-4 4h4m-4 4h4M6 5v14m12-14v14" },
  "sewer-facility": { color: "#a16207", path: "M5 12a7 7 0 1 0 14 0 7 7 0 1 0-14 0Zm3-2h8m-8 4h8m-4-6v8" },
  "telecom-tower": { color: "#a78bfa", path: "M12 4v16M8 20h8M9 8a5 5 0 0 0 0 8m6-8a5 5 0 0 1 0 8M6 5a9 9 0 0 0 0 14m12-14a9 9 0 0 1 0 14" },
  "telecom-facility": { color: "#8b5cf6", path: "M5 5h14v14H5Zm3 3h8m-8 4h8m-8 4h5" },
  "heat-facility": { color: "#ef4444", path: "M12 3c3 3 5 5 5 8 0 4-2 6-5 10-3-4-5-6-5-10 0-3 2-5 5-8Zm-2 8c1 1 3 1 4 0m-5 4c2 1 4 1 6 0" },
  industrial: { color: "#94a3b8", path: "M4 20V9l6 3V8l6 3V5l4 2v13H4Zm4-3h2m3 0h2m3 0h1" },
  military: { color: "#65a30d", path: "M12 3 4 7v6c0 5 3.5 8 8 10 4.5-2 8-5 8-10V7l-8-4Zm0 4 1.5 3.5 3.5.5-2.5 2.5.5 3.5-3-1.8-3 1.8.5-3.5L7 11l3.5-.5L12 7Z" },
  generic: { color: "#38bdf8", path: "M12 5a7 7 0 1 1 0 14 7 7 0 0 1 0-14Zm0 4v6m-3-3h6" },
};

export function mapSymbolKinds(): readonly MapSymbolKind[] { return iconKinds; }
export function mapSymbolImageId(kind: MapSymbolKind): string { return `mdq-symbol:${kind}`; }

export function mapSymbolSvg(kind: MapSymbolKind): string {
  const definition = symbolDefinitions[kind];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${SYMBOL_SIZE}" height="${SYMBOL_SIZE}"><circle cx="12" cy="12" r="10.4" fill="${definition.color}" stroke="#07111f" stroke-width="1.8"/><path d="${definition.path}" fill="none" stroke="#f8fafc" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

export function mapSymbolDataUrl(kind: MapSymbolKind): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(mapSymbolSvg(kind))}`;
}

export function pointSymbolKind(layer: PreviewLayer): MapSymbolKind {
  const artifact = layer.artifact.artifact_id;
  if (artifact === "power.assets") return "power-substation";
  if (artifact === "power.supports") return "power-tower";
  if (artifact.includes("hospital")) return "hospital";
  if (artifact.includes("fire")) return "fire-station";
  if (artifact.includes("police")) return "police";
  if (artifact.includes("ambulance")) return "ambulance";
  if (artifact.includes("administration")) return "townhall";
  if (artifact.includes("education")) return "school";
  if (artifact.includes("post")) return "post-office";
  if (artifact.includes("community")) return "library";
  if (artifact.includes("stations")) return "rail-station";
  if (artifact.includes("aviation")) return "aviation";
  if (artifact.includes("crossings")) return "crossing";
  if (artifact.startsWith("water.")) return "water-facility";
  if (artifact.startsWith("gas.")) return "gas-facility";
  if (artifact.startsWith("sewer.")) return "sewer-facility";
  if (artifact === "telecom.towers") return "telecom-tower";
  if (artifact.startsWith("telecom.")) return "telecom-facility";
  if (artifact.startsWith("district_heating.")) return "heat-facility";
  if (artifact.includes("military")) return "military";
  if (artifact.startsWith("industrial.")) return "industrial";
  return "generic";
}

export function pointSymbolExpression(layer: PreviewLayer): string | ExpressionSpecification {
  if (layer.artifact.artifact_id === "power.assets") return ["match", ["get", "asset_type"],
    "substation", mapSymbolImageId("power-substation"),
    "transformer", mapSymbolImageId("power-transformer"),
    "plant", mapSymbolImageId("power-plant"),
    "generator", mapSymbolImageId("power-generator"),
    "switch", mapSymbolImageId("power-switchgear"),
    "terminal", mapSymbolImageId("power-switchgear"),
    "converter", mapSymbolImageId("power-switchgear"),
    "compensator", mapSymbolImageId("power-switchgear"),
    "tower", mapSymbolImageId("power-tower"),
    "portal", mapSymbolImageId("power-portal"),
    "pole", mapSymbolImageId("power-pole"),
    "utility_pole", mapSymbolImageId("power-pole"),
    mapSymbolImageId("generic"),
  ] as ExpressionSpecification;
  if (layer.artifact.artifact_id !== "power.supports") return mapSymbolImageId(pointSymbolKind(layer));
  return ["match", ["get", "asset_type"],
    "tower", mapSymbolImageId("power-tower"),
    "portal", mapSymbolImageId("power-portal"),
    "utility_pole", mapSymbolImageId("power-pole"),
    "pole", mapSymbolImageId("power-pole"),
    mapSymbolImageId("power-tower"),
  ] as ExpressionSpecification;
}

export function pointSymbolSize(layer: PreviewLayer): number {
  return layer.artifact.artifact_id === "power.supports" ? 0.52 : 0.78;
}

export function legendItemsForLayer(layer: PreviewLayer): SymbolLegendItem[] {
  if (layer.artifact.artifact_id === "power.assets") return [
    { kind: "power-substation", label: "Substation" }, { kind: "power-transformer", label: "Transformer" }, { kind: "power-plant", label: "Power plant" }, { kind: "power-generator", label: "Generator" }, { kind: "power-switchgear", label: "Switchgear" }, { kind: "power-tower", label: "Transmission tower" }, { kind: "power-portal", label: "Line portal" }, { kind: "power-pole", label: "Utility pole" },
  ];
  if (layer.artifact.artifact_id === "power.supports") return [
    { kind: "power-tower", label: "Transmission tower" }, { kind: "power-portal", label: "Line portal" }, { kind: "power-pole", label: "Utility pole" },
  ];
  return [{ kind: pointSymbolKind(layer), label: layer.artifact.artifact_id.replace(/[._]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()) }];
}
