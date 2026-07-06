export type LayerCatalogEntry = {
  id: string;
  label: string;
  domain: string;
  source: string;
  access: string;
  geometry: string;
  endpoint: string;
  analytical_use: string;
  feature_count: number;
  quality_status: string;
  artifact: string;
  validation_report: string;
};

export type DataQualityIssue = {
  id: string;
  layer_id: string;
  severity: "low" | "medium" | "high";
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
};
