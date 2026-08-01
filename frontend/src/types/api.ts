export type LayerSourceType = "analytical_vector" | "manual_seed" | "reference_overlay";
export type LayerConfidence = "high" | "medium" | "low" | "not_applicable";
export type LayerReadiness = "ready" | "usable_with_limitations" | "needs_source" | "not_usable";

export type CachedMetadata = {
  aoi_id: string; domain: string; layer_id: string; source: string; source_type: LayerSourceType;
  confidence: LayerConfidence; limitations: string[]; readiness: LayerReadiness; feature_count: number;
  snapshot_at: string; source_query: string; usable_for_simulation: boolean;
};

export type ReadinessRecord = {
  domain: string; readiness: LayerReadiness; quality_status: string; highest_issue_severity: string | null; feature_count: number;
};

export type ProviderFeature = {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: GeoJSON.Geometry;
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

export type IssueReviewStatus = "open" | "acknowledged" | "resolved" | "accepted" | "ignored";

export type IssueReview = {
  status: IssueReviewStatus; note: string | null; created_at: string | null; updated_at: string | null;
};

export type ProviderIssue = {
  id: string; rule_id: string; rule_version: string; severity: "low" | "medium" | "high";
  source_type: LayerSourceType; domain: string; layer_id: string; category: string; title: string;
  evidence: string; recommendation: string; review: IssueReview;
};
