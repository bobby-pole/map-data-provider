import type { LayerSourceType } from "./layers";

export type IssueReviewStatus = "open" | "acknowledged" | "resolved" | "accepted" | "ignored";

export type IssueReview = {
  status: IssueReviewStatus;
  note: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type ProviderIssue = {
  id: string;
  rule_id: string;
  rule_version: string;
  severity: "low" | "medium" | "high";
  source_type: LayerSourceType;
  domain: string;
  layer_id: string;
  category: string;
  title: string;
  evidence: string;
  recommendation: string;
  review: IssueReview;
};
