import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { ProviderIssue } from "../types/api";
import { IssueReviewDrawer } from "./IssueReviewDrawer";

const sampleIssue: ProviderIssue = {
  id: "DQ-TEST-ISSUE",
  rule_id: "manual.non_authoritative",
  rule_version: "1.0",
  severity: "medium",
  source_type: "manual_seed",
  domain: "power",
  layer_id: "power.manual_seeds",
  category: "provenance",
  title: "Manual seed is non-authoritative",
  evidence: "Sample evidence.",
  recommendation: "Inspect source.",
  review: { status: "open", note: null, created_at: null, updated_at: null },
};

describe("IssueReviewDrawer", () => {
  it("hides mutation controls in public demo read-only mode", () => {
    const markup = renderToStaticMarkup(
      <IssueReviewDrawer issues={[sampleIssue]} updateReview={vi.fn()} readOnly />,
    );
    expect(markup).toContain("Manual seed is non-authoritative");
    expect(markup).toContain("Review edits are disabled in public demo mode.");
    expect(markup).not.toContain("Save review");
  });
});
