import type { ExpressionSpecification } from "maplibre-gl";

/** Pure style policy so the MVT preview can be verified without a WebGL runtime. */
export function isLinePresentationLayer(sourceLayer: string): boolean {
  return sourceLayer.includes("line");
}

export function presentationColor(index: number): string {
  return ["#f59e0b", "#38bdf8", "#a78bfa", "#34d399"][index % 4] ?? "#38bdf8";
}

export const voltageLineColor: ExpressionSpecification = [
  "match", ["get", "voltage_bucket"],
  "low", "#84cc16",
  "medium", "#c8a600",
  "high_110", "#dc2626",
  "high_220", "#d946ef",
  "high_400", "#a855f7",
  "#475569",
] as ExpressionSpecification;

export function supportStyle(assetType: string | undefined): { color: string; radius: number } {
  if (assetType === "tower") return { color: "#f97316", radius: 5 };
  if (assetType === "portal") return { color: "#facc15", radius: 4.5 };
  if (assetType === "utility_pole") return { color: "#38bdf8", radius: 3.5 };
  return { color: "#cbd5e1", radius: 3 };
}

/** Reference rasters supply visual context and must not obscure analytical vectors. */
export function referenceRasterInsertionPoint(layerIds: readonly string[]): string | undefined {
  return layerIds.find((layerId) => layerId.startsWith("provider:"));
}

/** Online-only visual context; it is not provider data and is never cached by this app. */
export const openStreetMapBasemap = {
  label: "OpenStreetMap base map",
  tileUrlTemplate: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  attribution: "© <a href=\"https://www.openstreetmap.org/copyright\">OpenStreetMap contributors</a>",
  minZoom: 0,
  maxZoom: 19,
} as const;
