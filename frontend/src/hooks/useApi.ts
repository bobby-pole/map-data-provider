import { useEffect, useState } from "react";
import type { CachedLayer, CachedMetadata, IssueReviewStatus, ProviderIssue, ReadinessRecord } from "../types/api";

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

export function useProviderPreview() {
  const [layer, setLayer] = useState<CachedLayer | null>(null);
  const [metadata, setMetadata] = useState<CachedMetadata | null>(null);
  const [readiness, setReadiness] = useState<ReadinessRecord | null>(null);
  const [issues, setIssues] = useState<ProviderIssue[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetchJson<CachedLayer>("/api/aoi/rybnik_60km/layers/power"),
      fetchJson<{ aoi_id: string; layers: CachedMetadata[] }>("/api/aoi/rybnik_60km/layers"),
      fetchJson<{ aoi_id: string; readiness: ReadinessRecord[] }>("/api/aoi/rybnik_60km/readiness"),
      fetchJson<{ aoi_id: string; issues: ProviderIssue[] }>("/api/aoi/rybnik_60km/issues"),
    ])
      .then(([layerData, layers, readinessData, issueData]) => {
        if (cancelled) return;
        setLayer(layerData);
        setMetadata(layers.layers.find((item) => item.domain === "power") ?? null);
        setReadiness(readinessData.readiness.find((item) => item.domain === "power") ?? null);
        setIssues(issueData.issues);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => { cancelled = true; };
  }, []);

  async function updateReview(issue: ProviderIssue, status: Exclude<IssueReviewStatus, "open">, note: string): Promise<void> {
    try {
      const response = await fetch(`/api/aoi/rybnik_60km/issues/${encodeURIComponent(issue.id)}/review`, {
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

  return { layer, metadata, readiness, issues, updateReview, error };
}
