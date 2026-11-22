import type { Geometry } from "geojson";

import type { RuntimeCategory } from "./runtime";

export type LayerSourceType = "analytical_vector" | "manual_seed" | "reference_overlay";
export type LayerConfidence = "high" | "medium" | "low" | "not_applicable";
export type LayerReadiness = "ready" | "usable_with_limitations" | "needs_source" | "not_usable";

export type RuntimeAcquisitionEvidence = {
  evidence_version: "provider_runtime_acquisition_evidence/v1";
  aoi_id: string;
  snapshot_id: string;
  resolved_geometry: Geometry;
  radius_m: number | null;
  allowed_domains: RuntimeCategory[];
  source_observed_at: string;
  overpass_endpoint: string | null;
  pipeline_version: string;
  published_at: string;
  domains: Array<{
    domain: RuntimeCategory;
    stage_durations_ms?: Record<string, number>;
    preparation_duration_ms: number | null;
    queried_feature_count: number | null;
    accepted_feature_count: number | null;
    rejected_feature_count: number | null;
    validation_status: "passed" | "warning" | "failed" | "unknown";
    limitations: string[];
    overpass_endpoint: string | null;
  }>;
};

export type CachedMetadata = {
  aoi_id: string;
  domain: string;
  layer_id: string;
  source: string;
  source_type: LayerSourceType;
  confidence: LayerConfidence;
  limitations: string[];
  eligible_for_analysis: boolean;
  readiness: LayerReadiness;
  feature_count: number;
  snapshot_at: string;
  source_query: string;
};

export type ReadinessRecord = {
  domain: string;
  readiness: LayerReadiness;
  quality_status: string;
  highest_issue_severity: string | null;
  feature_count: number;
};

export type ProviderFeature = {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: Geometry;
};

export type CachedLayer = {
  type: "FeatureCollection";
  metadata: CachedMetadata;
  features: ProviderFeature[];
};

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

export type DeliveryMetricsResponse = {
  response_version: "provider_delivery_metrics/v1";
  measured_at: string;
  git_revision: string | null;
  bundle_id: string;
  methodology: {
    samples_per_endpoint: number;
    percentile: string;
    service_mode: string;
    caveat: string;
  };
  environment: {
    base_url: string;
    aoi_id: string;
    node: string;
    platform: string;
    cpu_model: string;
  };
  api: Array<{
    id: string;
    method: "GET";
    path: string;
    sample_count: number;
    latency_ms: { p50: number; p95: number; p99: number };
    response_bytes: { mean: number; total: number };
  }>;
  pmtiles: {
    path: string;
    range: string;
    range_requests: { response_bytes: { mean: number; total: number } };
    revalidation_cache: {
      hits: number;
      misses: number;
      hit_ratio: number;
      hit_definition: string;
    };
  };
  delivered_inventory: {
    domains: number;
    public_layers: number;
    processed_feature_count: number;
  };
  fixture_worker: {
    fixture_mode: true;
    fixture_preparation: {
      duration_ms: number;
      domains: number;
      processed_feature_count: number;
    };
    worker: { successes: number; failures: number; success_rate: number };
    runtime_cache: { samples: number; hits: number; misses: number; hit_ratio: number };
    runtime_outcomes: { ready: number; needs_source: number; failed: number };
  };
  raw_report_url: "/api/metrics/delivery/raw";
};

export type SourceAvailabilityReport = {
  report_version: "provider_source_availability/v1";
  aoi_id: string;
  evidence_timestamp: string;
  sources: Array<{
    source_id: string;
    availability: string;
    aoi_coverage: string;
    feature_state: string;
    freshness: string;
    evidence: string;
    actionable_gap: boolean;
  }>;
};
