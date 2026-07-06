import { useEffect, useState } from "react";
import type { DataQualityIssue, DataQualityMetrics, LayerCatalogEntry } from "../types/api";

const API_BASE = "http://localhost:8000";

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

export function useDataQuality() {
  const [layers, setLayers] = useState<LayerCatalogEntry[]>([]);
  const [issues, setIssues] = useState<DataQualityIssue[]>([]);
  const [metrics, setMetrics] = useState<DataQualityMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [layerData, issueData, metricData] = await Promise.all([
          fetchJson<LayerCatalogEntry[]>("/api/layers/catalog"),
          fetchJson<DataQualityIssue[]>("/api/data-quality/issues"),
          fetchJson<DataQualityMetrics>("/api/data-quality/metrics"),
        ]);
        if (!cancelled) {
          setLayers(layerData);
          setIssues(issueData);
          setMetrics(metricData);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { layers, issues, metrics, error };
}
