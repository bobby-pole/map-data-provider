import type { DomainPack, DomainPackLayer, ProviderFeature, SourceRegistryV2Entry } from "./types/api";

export type PreviewLayer = DomainPackLayer & {
  domain: string;
  readiness: DomainPack["readiness"];
  sources: SourceRegistryV2Entry[];
};

export type PopupDetails = {
  title: string;
  source: string;
  confidence: string;
  readiness: string;
  limitations: string[];
};

export function configuredPreviewLayers(domainPacks: DomainPack[]): PreviewLayer[] {
  return domainPacks.flatMap((domainPack) => domainPack.layers.map((layer) => ({
    ...layer,
    domain: domainPack.domain,
    readiness: domainPack.readiness,
    sources: layer.artifact.source_provenance
      .map((provenance) => domainPack.sources.find((source) => source.id === provenance.source_id))
      .filter((source): source is SourceRegistryV2Entry => source !== undefined),
  })));
}

export function previewLayerKey(layer: PreviewLayer): string {
  return `${layer.domain}:${layer.artifact.id}`;
}

export function popupDetails(feature: ProviderFeature, layer: PreviewLayer): PopupDetails {
  const properties = feature.properties;
  const limitations = stringList(properties.limitations, layer.layer.metadata.limitations);
  return {
    title: stringValue(properties.asset_type)
      ?? stringValue(properties.category)
      ?? stringValue(properties.feature_type)
      ?? layer.artifact.id,
    source: stringValue(properties.source) ?? layer.layer.metadata.source,
    confidence: stringValue(properties.confidence) ?? layer.layer.metadata.confidence,
    readiness: layer.readiness.readiness,
    limitations,
  };
}

export function sourceAttribution(layer: PreviewLayer): string {
  const labels = layer.sources.map((source) => source.attribution || source.name);
  return labels.length > 0 ? labels.join("; ") : layer.layer.metadata.source;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function stringList(value: unknown, fallback: string[]): string[] {
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) return value;
  return fallback;
}
