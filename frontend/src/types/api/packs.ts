import type {
  CachedLayer,
  LayerConfidence,
  LayerReadiness,
  ProviderFeature,
  ReadinessRecord,
  SourceProvenance,
  SourceRegistryV2Entry,
} from "./layers";

export type DomainPackArtifact = {
  id: string;
  kind: "processed_vector" | "derived_vector" | "representative_points";
  format: "geojson";
  feature_count?: number;
  source_provenance: SourceProvenance[];
  public_export: true;
};

export type DomainPackLayer = {
  artifact: DomainPackArtifact;
  layer: CachedLayer;
};

export type DomainPack = {
  response_version: "provider_domain_pack_read/v2";
  aoi_id: string;
  domain: string;
  source_provenance: SourceProvenance[];
  readiness: ReadinessRecord;
  layers: DomainPackLayer[];
  sources: SourceRegistryV2Entry[];
};

export type DomainPackListResponse = {
  response_version: "provider_domain_pack_list/v2";
  aoi_id: string;
  domain_packs: DomainPack[];
};

export type MapPresentationLayer = {
  artifact_id: string;
  source_layer: string;
  feature_count: number;
  source: string;
  confidence: LayerConfidence;
  readiness: LayerReadiness;
  limitations: string[];
  attribution: string;
  attribution_html?: string;
  source_provenance: SourceProvenance[];
};

export type MapPresentation = {
  response_version: "provider_map_presentation_read/v1";
  presentation_version: "provider_map_presentation/v1";
  aoi_id: string;
  domain: string;
  archive: {
    format: "pmtiles";
    size_bytes: number;
    min_zoom: number;
    max_zoom: number;
    bounds: [number, number, number, number];
  };
  layers: MapPresentationLayer[];
  attribution: string;
  archive_url: string;
};

export type MapPresentationListResponse = {
  response_version: "provider_map_presentation_list/v1";
  aoi_id: string;
  presentations: MapPresentation[];
};

export type MapFeatureDetail = {
  response_version: "provider_map_feature_detail/v1";
  aoi_id: string;
  domain: string;
  artifact_id: string;
  source_id: string;
  feature: ProviderFeature;
};

export type MapCircuitSummary = {
  relation_id: string;
  tags: Record<string, string>;
  aoi_coverage: "bounded_source_snapshot";
  member_count: number;
};

export type MapCircuitMember = {
  source_id: string;
  role: string;
  availability?: string;
  endpoint_evidence?: { start: string; end: string };
  geometry?: { type: "LineString"; coordinates: [number, number][] };
};

export type MapCircuit = MapCircuitSummary & {
  limitations: string[];
  members: MapCircuitMember[];
};

export type MapCircuitList = {
  response_version: "provider_map_circuit_list/v1";
  aoi_id: string;
  domain: string;
  source_id: string;
  state: "available" | "not_applicable" | "unavailable";
  circuits: MapCircuitSummary[];
  limitations?: string[];
};

export type MapCircuitDetail = {
  response_version: "provider_map_circuit_detail/v1";
  aoi_id: string;
  domain: string;
  circuit: MapCircuit;
};
