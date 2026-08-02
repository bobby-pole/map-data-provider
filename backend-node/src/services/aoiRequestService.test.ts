import { describe, expect, it, vi } from "vitest";

import { CACHE_FRESHNESS_MS, isFresh, requestAoi } from "./aoiRequestService.js";
import type { CachedMetadata } from "../types/provider.js";

const metadata = (snapshot_at: string): CachedMetadata => ({
  cache_layout_version: "provider_cache/v1", geojson_contract_version: "provider_geojson/v1", aoi_id: "rybnik_60km", domain: "power", layer_id: "power.lines", source: "OpenStreetMap", source_type: "analytical_vector", source_registry_id: "openstreetmap", source_url: "https://overpass-api.de/api/interpreter", source_query: "fixture", snapshot_at, pipeline_version: "v1", query_version: "v1", validation_status_raw: "pass", quality_status: "passed", confidence: "medium", limitations: [], eligible_for_analysis: true, readiness: "ready", feature_count: 1,
});

describe("AOI request orchestration", () => {
  it("uses fresh cache without running the worker", async () => {
    const worker = vi.fn();
    const result = await requestAoi("rybnik_60km", "power", { readCachedLayers: async () => [metadata("2026-07-22T00:00:00Z")], runWorker: worker, now: () => new Date("2026-07-22T01:00:00Z") });
    expect(result.result).toBe("cache"); expect(worker).not.toHaveBeenCalled();
  });
  it("runs worker for missing cache and returns refresh", async () => {
    const worker = vi.fn(); let calls = 0;
    const result = await requestAoi("rybnik_60km", "power", { readCachedLayers: async () => (++calls === 1 ? [] : [metadata("2026-07-22T00:00:00Z")]), runWorker: worker, now: () => new Date("2026-07-22T01:00:00Z") });
    expect(result.result).toBe("refresh"); expect(worker).toHaveBeenCalledOnce();
  });
  it("runs worker for stale cache and propagates failure", async () => {
    await expect(requestAoi("rybnik_60km", "power", { readCachedLayers: async () => [metadata("2026-07-20T00:00:00Z")], runWorker: async () => { throw new Error("boom"); }, now: () => new Date("2026-07-22T01:00:00Z") })).rejects.toMatchObject({ kind: "worker_failed" });
  });
  it("has deterministic freshness and rejects unsupported combinations", async () => {
    expect(isFresh(metadata("2026-07-21T01:00:00Z"), new Date("2026-07-22T01:00:00Z"))).toBe(true);
    expect(CACHE_FRESHNESS_MS).toBe(86_400_000);
    await expect(requestAoi("unknown", "power")).rejects.toMatchObject({ kind: "invalid_request" });
    await expect(requestAoi("rybnik_60km", "transport")).rejects.toMatchObject({ kind: "invalid_request" });
  });
});
