import { useState } from "react";

import {
  filterIssuesByReviewState,
  isFinalReviewState,
  nextReviewStates,
  reviewStatuses,
} from "../reviewWorkflow";
import type { IssueReviewStatus, ProviderIssue } from "../types/api";

export function IssueReviewDrawer({
  issues,
  updateReview,
}: {
  issues: ProviderIssue[];
  updateReview: (
    issue: ProviderIssue,
    status: Exclude<IssueReviewStatus, "open">,
    note: string,
  ) => Promise<void>;
}) {
  const [filter, setFilter] = useState<IssueReviewStatus | "all">("all");
  const [draftStates, setDraftStates] = useState<
    Record<string, Exclude<IssueReviewStatus, "open">>
  >({});
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const visibleIssues = filterIssuesByReviewState(issues, filter);

  async function saveReview(issue: ProviderIssue) {
    const status = draftStates[issue.id];
    if (!status || saving) {
      return;
    }
    setSaving(issue.id);
    try {
      await updateReview(issue, status, draftNotes[issue.id] ?? issue.review.note ?? "");
      setDraftStates((current) => {
        const remaining = { ...current };
        delete remaining[issue.id];
        return remaining;
      });
    } finally {
      setSaving(null);
    }
  }

  return (
    <details className="issueDrawer">
      <summary>Quality review · {issues.length} generated issues</summary>
      <div className="issueDrawerContent">
        <p className="muted">
          Human review is separate from generated evidence and does not alter readiness.
        </p>
        <label>
          Filter review state
          <select
            value={filter}
            onChange={(event) => setFilter(event.target.value as IssueReviewStatus | "all")}
          >
            <option value="all">all states</option>
            {reviewStatuses.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <div className="issueList">
          {visibleIssues.map((issue) => (
            <article className="issue" key={issue.id}>
              <span className={`severity severity-${issue.severity}`}>{issue.severity}</span>
              <strong>{issue.title}</strong>
              <small>
                {issue.rule_id} v{issue.rule_version} · {issue.review.status}
              </small>
              <p>{issue.evidence}</p>
              <small>{issue.recommendation}</small>
              {isFinalReviewState(issue.review.status) ? (
                <p className="muted">
                  Final decision{issue.review.note ? `: ${issue.review.note}` : "."}
                </p>
              ) : (
                <>
                  <label>
                    Next review state
                    <select
                      value={draftStates[issue.id] ?? ""}
                      onChange={(event) =>
                        setDraftStates((current) => ({
                          ...current,
                          [issue.id]: event.target.value as Exclude<IssueReviewStatus, "open">,
                        }))
                      }
                    >
                      <option value="">select allowed state</option>
                      {nextReviewStates(issue.review.status).map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Optional review note
                    <textarea
                      value={draftNotes[issue.id] ?? issue.review.note ?? ""}
                      onChange={(event) =>
                        setDraftNotes((current) => ({ ...current, [issue.id]: event.target.value }))
                      }
                      maxLength={1000}
                    />
                  </label>
                  <button
                    type="button"
                    disabled={!draftStates[issue.id] || saving === issue.id}
                    onClick={() => void saveReview(issue)}
                  >
                    {saving === issue.id ? "Saving…" : "Save review"}
                  </button>
                </>
              )}
            </article>
          ))}
          {issues.length > 0 && visibleIssues.length === 0 && (
            <p className="muted">No issues match this review state.</p>
          )}
        </div>
      </div>
    </details>
  );
}
