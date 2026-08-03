import type { MapPresentation, MapPresentationLayer, ProviderFeature } from "./types/api";

export type PreviewLayer = {
  artifact: MapPresentationLayer;
  domain: string;
  archiveUrl: string;
  archiveBounds: MapPresentation["archive"]["bounds"];
  archiveMinZoom: number;
  archiveMaxZoom: number;
};

export type PopupDetails = {
  title: string;
  source: string;
  confidence: string;
  readiness: string;
  limitations: string[];
};

export function configuredPreviewLayers(presentations: MapPresentation[]): PreviewLayer[] {
  return presentations.flatMap((presentation) => presentation.layers.map((artifact) => ({
    artifact,
    domain: presentation.domain,
    archiveUrl: presentation.archive_url,
    archiveBounds: presentation.archive.bounds,
    archiveMinZoom: presentation.archive.min_zoom,
    archiveMaxZoom: presentation.archive.max_zoom,
  })));
}

export function previewLayerKey(layer: PreviewLayer): string {
  return `${layer.domain}:${layer.artifact.artifact_id}`;
}

export function popupDetails(feature: ProviderFeature, layer: PreviewLayer): PopupDetails {
  const properties = feature.properties;
  const limitations = stringList(properties.limitations, layer.artifact.limitations);
  return {
    title: stringValue(properties.asset_type)
      ?? stringValue(properties.category)
      ?? stringValue(properties.feature_type)
      ?? layer.artifact.artifact_id,
    source: stringValue(properties.source) ?? layer.artifact.source,
    confidence: stringValue(properties.confidence) ?? layer.artifact.confidence,
    readiness: layer.artifact.readiness,
    limitations,
  };
}

export function sourceAttribution(layer: PreviewLayer): string {
  return layer.artifact.attribution || layer.artifact.source;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function stringList(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value;
  if (typeof value === "string" && value.trim()) return value.split(";").map((item) => item.trim()).filter(Boolean);
  return fallback;
}
