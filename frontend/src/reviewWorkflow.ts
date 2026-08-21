import type { IssueReviewStatus, ProviderIssue } from "./types/api";

export const reviewStatuses: IssueReviewStatus[] = [
  "open",
  "acknowledged",
  "resolved",
  "accepted",
  "ignored",
];

export function nextReviewStates(status: IssueReviewStatus): Exclude<IssueReviewStatus, "open">[] {
  if (status === "open") {
    return ["acknowledged", "resolved", "accepted", "ignored"];
  }
  if (status === "acknowledged") {
    return ["resolved", "accepted", "ignored"];
  }
  return [];
}

export function isFinalReviewState(status: IssueReviewStatus): boolean {
  return status === "resolved" || status === "accepted" || status === "ignored";
}

export function filterIssuesByReviewState(
  issues: ProviderIssue[],
  filter: IssueReviewStatus | "all",
): ProviderIssue[] {
  return filter === "all" ? issues : issues.filter((issue) => issue.review.status === filter);
}
