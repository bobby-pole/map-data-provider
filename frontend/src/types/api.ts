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

export type RuntimeCategory = "power" | "emergency" | "public" | "transport" | "bridges" | "water" | "gas" | "sewer" | "industrial" | "telecom";
export type RuntimeAoiInput = { type: "point_radius"; longitude: number; latitude: number; radius_m: number } | { type: "administrative_selection"; unit_ids: string[] };
export type AdministrativeCatalog = { catalog_version: "prg_administrative_catalog/v1"; source_registry_id: "prg_wfs"; snapshot_at: string; source_crs: "EPSG:4326"; limitations: string[]; units: Array<{ id: string; kind: "voivodeship" | "county" | "gmina"; name: string; prg_id: string; geometry: Geometry }> };
export type ProviderRuntimeResponse = {
  status: "ok"; request_contract_version: "provider_aoi_request/v2"; request_id: string; cache_key: string; pipeline_version: string; job_state: "ready"; request_result: "cache" | "refresh"; cached_at: string;
  aoi: { aoi_id: string; geometry: Geometry; input_type: "circle" | "administrative_selection"; constraints: Record<string, number>; boundary_provenance: Record<string, unknown> };
  outcomes: Array<{ domain: RuntimeCategory; source_registry_id: string; source_role: string; output_kind: string; query_version: string; tags: Record<string, string[]>; status: "ready" | "needs_source" | "reference_only" | "pending_qualification"; detail: string; artifact_aoi_id: string | null; cache_status: "fresh" | "missing"; queried_feature_count: number | null; accepted_feature_count: number | null; derived_feature_count: number | null }>;
  contexts: Array<{ domain: RuntimeCategory | "administrative"; source_registry_id: string; output_kind: string; status: "ready" | "needs_source" | "reference_only" | "pending_qualification"; detail: string }>;
};
