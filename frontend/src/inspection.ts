import { popupDetails, sourceAttribution, type PreviewLayer } from "./previewCatalog";
import type { ProviderFeature } from "./types/api";

export type SelectedProviderFeature = {
  feature: ProviderFeature;
  layer: PreviewLayer;
};

export type FeatureInspection = {
  title: string;
  source: string;
  attribution: string;
  confidence: string;
  readiness: string;
  limitations: string[];
  providerAttributes: Array<{ name: string; value: string }>;
};

export function featureInspection(selected: SelectedProviderFeature): FeatureInspection {
  const details = popupDetails(selected.feature, selected.layer);
  return {
    ...details,
    attribution: sourceAttribution(selected.layer),
    providerAttributes: Object.entries(selected.feature.properties)
      // Source-specific tags remain in the response, but are not provider-normalized evidence.
      .filter(([name]) => name !== "osm_tags")
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => ({ name, value: displayValue(value) })),
  };
}

function displayValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null || value === undefined) return "not provided";
  return JSON.stringify(value);
}
