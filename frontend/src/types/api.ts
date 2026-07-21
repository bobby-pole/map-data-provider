export type LayerSourceType = "analytical_vector" | "manual_seed" | "reference_overlay";
export type LayerConfidence = "high" | "medium" | "low" | "not_applicable";
export type LayerQualityStatus = "passed" | "warning" | "failed" | "unknown";
export type LayerReadiness = "ready" | "usable_with_limitations" | "needs_source" | "not_usable";
export type IssueSeverity = "low" | "medium" | "high";

export type LayerCatalogEntry = {
  id: string;
  label: string;
  domain: string;
  source: string;
  source_type: LayerSourceType;
  confidence: LayerConfidence;
  limitations: string[];
  not_authoritative: boolean;
  usable_for_simulation: boolean;
  access: string;
  geometry: string;
  endpoint: string;
  analytical_use: string;
  feature_count: number;
  quality_status: LayerQualityStatus;
  validation_status_raw: string | null;
  readiness: LayerReadiness;
  artifact: string | null;
  validation_report: string | null;
};

export type DataQualityIssue = {
  id: string;
  rule_id: string;
  rule_version: string;
  source_type: LayerSourceType;
  domain: string;
  layer_id: string;
  affected_object: { type: "layer" | "feature"; id: string };
  severity: IssueSeverity;
  category: string;
  title: string;
  evidence: string;
  recommendation: string;
  status: "open" | "accepted" | "ignored" | "needs-source";
};

export type DataQualityMetrics = {
  total_issues: number;
  open_issues: number;
  issues_by_severity: Record<string, number>;
  issues_by_category: Record<string, number>;
  layers: number;
  layers_by_quality_status: Partial<Record<LayerQualityStatus, number>>;
  layers_by_readiness: Partial<Record<LayerReadiness, number>>;
};
