import { useEffect, useState } from "react";
import type { CachedLayer, CachedMetadata, ReadinessRecord } from "../types/api";

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

export function useProviderPreview() {
  const [layer, setLayer] = useState<CachedLayer | null>(null);
  const [metadata, setMetadata] = useState<CachedMetadata | null>(null);
  const [readiness, setReadiness] = useState<ReadinessRecord | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetchJson<CachedLayer>("/api/aoi/rybnik_60km/layers/power"),
      fetchJson<{ aoi_id: string; layers: CachedMetadata[] }>("/api/aoi/rybnik_60km/layers"),
      fetchJson<{ aoi_id: string; readiness: ReadinessRecord[] }>("/api/aoi/rybnik_60km/readiness"),
    ])
      .then(([layerData, layers, readinessData]) => {
        if (cancelled) return;
        setLayer(layerData);
        setMetadata(layers.layers.find((item) => item.domain === "power") ?? null);
        setReadiness(readinessData.readiness.find((item) => item.domain === "power") ?? null);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => { cancelled = true; };
  }, []);

  return { layer, metadata, readiness, error };
}
