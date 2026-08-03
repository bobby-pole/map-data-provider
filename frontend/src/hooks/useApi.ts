import { useEffect, useState } from "react";
import type { IssueReviewStatus, MapPresentation, MapPresentationListResponse, ProviderIssue, SourceAvailabilityReport } from "../types/api";

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

const defaultPreviewAoiId = import.meta.env.VITE_PROVIDER_PREVIEW_AOI ?? "rybnik_60km";

export function useProviderPreview(aoiId = defaultPreviewAoiId) {
  const [presentations, setPresentations] = useState<MapPresentation[]>([]);
  const [issues, setIssues] = useState<ProviderIssue[]>([]);
  const [sourceAvailability, setSourceAvailability] = useState<SourceAvailabilityReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetchJson<MapPresentationListResponse>(`/api/aoi/${encodeURIComponent(aoiId)}/presentations`),
      fetchJson<{ aoi_id: string; issues: ProviderIssue[] }>(`/api/aoi/${encodeURIComponent(aoiId)}/issues`),
      fetchJson<SourceAvailabilityReport>(`/api/aoi/${encodeURIComponent(aoiId)}/source-availability`),
    ])
      .then(([presentationData, issueData, availabilityData]) => {
        if (cancelled) return;
        setPresentations(presentationData.presentations);
        setIssues(issueData.issues);
        setSourceAvailability(availabilityData);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => { cancelled = true; };
  }, [aoiId]);

  async function updateReview(issue: ProviderIssue, status: Exclude<IssueReviewStatus, "open">, note: string): Promise<void> {
    try {
      const response = await fetch(`/api/aoi/${encodeURIComponent(aoiId)}/issues/${encodeURIComponent(issue.id)}/review`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status, note: note || null, expected_updated_at: issue.review.updated_at }),
      });
      if (!response.ok) throw new Error(`Review update: HTTP ${response.status}`);
      const updated = await response.json() as ProviderIssue;
      setIssues((current) => current.map((item) => item.id === updated.id ? updated : item));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      throw reason;
    }
  }

  return { aoiId, presentations, issues, sourceAvailability, updateReview, error };
}
