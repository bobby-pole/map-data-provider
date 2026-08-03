import type { Geometry } from "geojson";

export type LayerSourceType = "analytical_vector" | "manual_seed" | "reference_overlay";
export type LayerConfidence = "high" | "medium" | "low" | "not_applicable";
export type LayerReadiness = "ready" | "usable_with_limitations" | "needs_source" | "not_usable";

export type CachedMetadata = {
  aoi_id: string; domain: string; layer_id: string; source: string; source_type: LayerSourceType;
  confidence: LayerConfidence; limitations: string[]; eligible_for_analysis: boolean; readiness: LayerReadiness; feature_count: number;
  snapshot_at: string; source_query: string;
};

export type ReadinessRecord = {
  domain: string; readiness: LayerReadiness; quality_status: string; highest_issue_severity: string | null; feature_count: number;
};

export type ProviderFeature = {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: Geometry;
};

export type CachedLayer = { type: "FeatureCollection"; metadata: CachedMetadata; features: ProviderFeature[] };

export type SourceProvenance = {
  source_id: string;
  contribution_role: "primary" | "supplementary" | "validation_reference" | "derived_context";
};

export type SourceRegistryV2Entry = {
  id: string;
  name: string;
  attribution: string;
  usage_role: "analytical" | "reference" | "review";
  distribution: { public_export: "allowed" | "prohibited"; reason: string };
  limitations: string[];
};

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

export type MapCircuitSummary = { relation_id: string; tags: Record<string, string>; aoi_coverage: "bounded_source_snapshot"; member_count: number };
export type MapCircuit = MapCircuitSummary & { limitations: string[]; members: Array<{ source_id: string; role: string; availability?: string; endpoint_evidence?: { start: string; end: string }; geometry?: { type: "LineString"; coordinates: [number, number][] } }> };
export type MapCircuitList = {
  response_version: "provider_map_circuit_list/v1"; aoi_id: string; domain: string; source_id: string;
  state: "available" | "not_applicable"; circuits: MapCircuitSummary[];
};
export type MapCircuitDetail = { response_version: "provider_map_circuit_detail/v1"; aoi_id: string; domain: string; circuit: MapCircuit };
export type SourceAvailabilityReport = { report_version: "provider_source_availability/v1"; aoi_id: string; evidence_timestamp: string; sources: Array<{ source_id: string; availability: string; aoi_coverage: string; feature_state: string; freshness: string; evidence: string; actionable_gap: boolean }> };

export type IssueReviewStatus = "open" | "acknowledged" | "resolved" | "accepted" | "ignored";

export type IssueReview = {
  status: IssueReviewStatus; note: string | null; created_at: string | null; updated_at: string | null;
};

export type ProviderIssue = {
  id: string; rule_id: string; rule_version: string; severity: "low" | "medium" | "high";
  source_type: LayerSourceType; domain: string; layer_id: string; category: string; title: string;
  evidence: string; recommendation: string; review: IssueReview;
};
