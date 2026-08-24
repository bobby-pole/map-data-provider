import type { ExpressionSpecification } from "maplibre-gl";

export type VisualBasemapMode = "standard" | "dark" | "none";

export const visualBasemapOptions: ReadonlyArray<{
  id: VisualBasemapMode;
  label: string;
  detail: string;
}> = [
  { id: "standard", label: "Standard OSM", detail: "Attributed OpenStreetMap raster tiles." },
  {
    id: "dark",
    label: "Dark OSM",
    detail: "Local visual treatment of the same attributed OSM tiles.",
  },
  {
    id: "none",
    label: "No base map",
    detail: "Neutral canvas; provider and reference layers remain unchanged.",
  },
] as const;

/** Pure style policy so the MVT preview can be verified without a WebGL runtime. */
export function isLinePresentationLayer(sourceLayer: string): boolean {
  return (
    sourceLayer.includes("line") ||
    sourceLayer.endsWith(".roads") ||
    sourceLayer.endsWith(".railways") ||
    sourceLayer.endsWith("_roads") ||
    sourceLayer.endsWith("_railways") ||
    sourceLayer.endsWith(".bridges") ||
    sourceLayer.endsWith(".viaducts") ||
    sourceLayer.endsWith("_bridges") ||
    sourceLayer.endsWith("_viaducts") ||
    sourceLayer.endsWith(".waterways") ||
    sourceLayer.endsWith(".pipelines") ||
    sourceLayer.endsWith("_waterways") ||
    sourceLayer.endsWith("_pipelines")
  );
}

export function presentationColor(index: number): string {
  return ["#f59e0b", "#38bdf8", "#a78bfa", "#34d399"][index % 4] ?? "#38bdf8";
}

export const POWER_VOLTAGE_TIERS = [
  {
    voltage_bucket: "high_400",
    color: "#a855f7",
    label: "400 kV Transmission line",
    description: "Extra High Voltage (400 kV)",
  },
  {
    voltage_bucket: "high_220",
    color: "#d946ef",
    label: "220 kV Transmission line",
    description: "High Voltage (220 kV)",
  },
  {
    voltage_bucket: "high_110",
    color: "#dc2626",
    label: "110 kV Distribution line",
    description: "High Voltage (110 kV)",
  },
  {
    voltage_bucket: "medium",
    color: "#c8a600",
    label: "Medium Voltage line",
    description: "Medium Voltage (15–30 kV)",
  },
  {
    voltage_bucket: "low",
    color: "#84cc16",
    label: "Low Voltage line",
    description: "Low Voltage (0.4 kV)",
  },
  {
    voltage_bucket: "other",
    color: "#475569",
    label: "Unspecified voltage line",
    description: "Unspecified / other voltage",
  },
] as const;

/** Labels appear only when the respective density remains readable. */
export const powerVoltageLabelMinZoom = {
  transmission: 12,
  medium: 13,
  low: 15,
} as const;

export const voltageLineColor: ExpressionSpecification = [
  "match",
  ["get", "voltage_bucket"],
  "low",
  "#84cc16",
  "medium",
  "#c8a600",
  "high_110",
  "#dc2626",
  "high_220",
  "#d946ef",
  "high_400",
  "#a855f7",
  "#475569",
] as ExpressionSpecification;

export const roadLineColor: ExpressionSpecification = [
  "match",
  ["get", "road_class"],
  "major",
  "#ef4444",
  "secondary",
  "#f59e0b",
  "local",
  "#10b981",
  "service",
  "#6b7280",
  "#38bdf8",
] as ExpressionSpecification;

export const bridgeLineColor: ExpressionSpecification = [
  "match",
  ["get", "asset_type"],
  "bridges",
  "#0284c7",
  "viaducts",
  "#a855f7",
  "#0284c7",
] as ExpressionSpecification;

export function supportStyle(assetType: string | undefined): { color: string; radius: number } {
  if (assetType === "tower") {
    return { color: "#f97316", radius: 5 };
  }
  if (assetType === "portal") {
    return { color: "#facc15", radius: 4.5 };
  }
  if (assetType === "utility_pole") {
    return { color: "#38bdf8", radius: 3.5 };
  }
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
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>',
  minZoom: 0,
  maxZoom: 19,
} as const;

/** Raster paint only changes visual presentation; it never changes the OSM source. */
export function baseMapRasterPaint(
  mode: Exclude<VisualBasemapMode, "none">,
): Record<string, number> {
  return mode === "dark"
    ? {
        "raster-opacity": 0.66,
        "raster-brightness-min": 0.03,
        "raster-brightness-max": 0.38,
        "raster-saturation": -0.78,
        "raster-contrast": 0.26,
      }
    : {
        "raster-opacity": 0.9,
        "raster-brightness-min": 0,
        "raster-brightness-max": 1,
        "raster-saturation": 0,
        "raster-contrast": 0,
      };
}
