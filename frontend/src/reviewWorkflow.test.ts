import { describe, expect, it } from "vitest";

import { filterIssuesByReviewState, isFinalReviewState, nextReviewStates } from "./reviewWorkflow";
import type { ProviderIssue } from "./types/api";

const issue = (id: string, status: ProviderIssue["review"]["status"]): ProviderIssue => ({
  id,
  rule_id: "validation.status",
  rule_version: "1.0",
  severity: "medium",
  source_type: "analytical_vector",
  domain: "power",
  layer_id: "power.lines",
  category: "quality_status",
  title: "Generated issue",
  evidence: "Generated evidence",
  recommendation: "Inspect evidence",
  review: { status, note: null, created_at: null, updated_at: null },
});

describe("issue review preview workflow", () => {
  it("offers only lifecycle transitions accepted by the provider", () => {
    expect(nextReviewStates("open")).toEqual(["acknowledged", "resolved", "accepted", "ignored"]);
    expect(nextReviewStates("acknowledged")).toEqual(["resolved", "accepted", "ignored"]);
    expect(nextReviewStates("resolved")).toEqual([]);
  });

  it("recognizes terminal review states", () => {
    expect(isFinalReviewState("accepted")).toBe(true);
    expect(isFinalReviewState("ignored")).toBe(true);
    expect(isFinalReviewState("acknowledged")).toBe(false);
  });

  it("filters issues by the selected review state", () => {
    const issues = [issue("DQ-OPEN", "open"), issue("DQ-ACK", "acknowledged")];
    expect(filterIssuesByReviewState(issues, "acknowledged").map((item) => item.id)).toEqual(["DQ-ACK"]);
    expect(filterIssuesByReviewState(issues, "all")).toHaveLength(2);
  });
});
