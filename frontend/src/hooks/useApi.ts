import { useEffect, useState } from "react";
import type { DomainPack, DomainPackListResponse, IssueReviewStatus, ProviderIssue } from "../types/api";

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

const defaultPreviewAoiId = import.meta.env.VITE_PROVIDER_PREVIEW_AOI ?? "rybnik_60km";

export function useProviderPreview(aoiId = defaultPreviewAoiId) {
  const [domainPacks, setDomainPacks] = useState<DomainPack[]>([]);
  const [issues, setIssues] = useState<ProviderIssue[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetchJson<DomainPackListResponse>(`/api/aoi/${encodeURIComponent(aoiId)}/domain-packs`),
      fetchJson<{ aoi_id: string; issues: ProviderIssue[] }>(`/api/aoi/${encodeURIComponent(aoiId)}/issues`),
    ])
      .then(([domainPackData, issueData]) => {
        if (cancelled) return;
        setDomainPacks(domainPackData.domain_packs);
        setIssues(issueData.issues);
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

  return { aoiId, domainPacks, issues, updateReview, error };
}
