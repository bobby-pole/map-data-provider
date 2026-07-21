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
  properties: { source: string; source_id: string; asset_type: string; confidence: LayerConfidence; missing_fields: string[]; limitations: string[]; usable_for_simulation: boolean };
  geometry: GeoJSON.Geometry;
};

export type CachedLayer = { type: "FeatureCollection"; metadata: CachedMetadata; features: ProviderFeature[] };
