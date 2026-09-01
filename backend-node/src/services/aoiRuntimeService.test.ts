import { describe, expect, it } from "vitest";

import {
  providerRuntimeJobSchema,
  type ProviderRuntimeRequest,
  providerRuntimeResponseSchema,
} from "../types/provider.js";
import {
  createRuntimeJobCoordinator,
  createRuntimeRequestCoordinator,
  PUBLIC_DEMO_REFRESH_COOLDOWN_MS,
  workerFailureMessage,
} from "./aoiRuntimeService.js";
import { ProviderDataError } from "./providerDataService.js";

const request: ProviderRuntimeRequest = {
  aoi: { type: "administrative_selection", unit_ids: ["county_rybnik_city", "county_rybnicki"] },
  profiles: ["power", "water"],
};
const response = providerRuntimeResponseSchema.parse({
  status: "ok",
  request_contract_version: "provider_aoi_request/v2",
  request_id: "request_fixture",
  cache_key: "request_fixture",
  pipeline_version: "fixture/v1",
  job_state: "ready",
  request_result: "refresh",
  cached_at: "2026-08-03T00:00:00Z",
  aoi: {
    aoi_contract_version: "provider_aoi/v1",
    aoi_id: "aoi_fixture",
    cache_key: "aoi_fixture",
    geometry: { type: "Polygon", coordinates: [] },
    geometry_crs: "EPSG:4326",
    input_type: "administrative_selection",
    source_crs: "EPSG:4326",
    boundary_provenance: {},
    constraints: { max_area_sq_m: 1, min_radius_m: 1, max_radius_m: 1 },
    aliases: [],
  },
  profiles: [],
  outcomes: [],
  contexts: [],
});

describe("runtime request coordinator", () => {
  it("coalesces equivalent in-progress requests despite input ordering", async () => {
    let calls = 0;
    let release: (() => void) | undefined;
    const coordinator = createRuntimeRequestCoordinator(async () => {
      calls += 1;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return response;
    });
    const first = coordinator.submit(request);
    const equivalent = coordinator.submit({
      aoi: {
        type: "administrative_selection",
        unit_ids: ["county_rybnicki", "county_rybnik_city"],
      },
      profiles: ["water", "power"],
    });
    expect(calls).toBe(1);
    release?.();
    await expect(Promise.all([first, equivalent])).resolves.toEqual([response, response]);
  });

  it("preserves structured worker failures without exposing raw subprocess output", () => {
    expect(
      workerFailureMessage(
        { stderr: '{"status":"error","code":"worker_failed","message":"Overpass timed out."}' },
        "fallback",
      ),
    ).toBe("worker_failed: Overpass timed out.");
    expect(workerFailureMessage({ stderr: "not-json" }, "Safe fallback.")).toBe("Safe fallback.");
    expect(workerFailureMessage({ signal: "SIGKILL" }, "Safe fallback.")).toBe(
      "worker_terminated: AOI preparation worker exited with SIGKILL before publishing a snapshot.",
    );
    expect(workerFailureMessage({ spawnErrorCode: "EAGAIN" }, "Safe fallback.")).toBe(
      "worker_spawn_failed: AOI preparation worker could not be started (EAGAIN).",
    );
    expect(workerFailureMessage({ exitCode: 3 }, "Safe fallback.")).toBe(
      "worker_failed: AOI preparation worker exited with code 3 before publishing a snapshot.",
    );
    expect(
      workerFailureMessage(
        new ProviderDataError(
          "worker_failed",
          "worker_spawn_failed: worker could not be started (ENOENT).",
        ),
        "Safe fallback.",
      ),
    ).toBe("worker_spawn_failed: worker could not be started (ENOENT).");
  });

  it("exposes real worker progress before the final runtime response is available", async () => {
    const coordinator = createRuntimeJobCoordinator(async (_request, report) => {
      report({
        event: "domain_started",
        total_domains: 2,
        completed_domains: 1,
        active_domain: "power",
        queried_feature_count: 12,
        accepted_feature_count: 9,
        derived_feature_count: 2,
      });
      return response;
    });
    const job = coordinator.submit(request);
    expect(providerRuntimeJobSchema.parse(coordinator.get(job.job_id))).toMatchObject({
      state: "running",
      event: "domain_started",
      completed_domains: 1,
      active_domain: "power",
      accepted_feature_count: 9,
    });
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(coordinator.get(job.job_id)).toMatchObject({
      state: "succeeded",
      event: "published",
      result: response,
    });
  });

  it("finds only a queued or running job for the same canonical AOI", async () => {
    let release: (() => void) | undefined;
    const coordinator = createRuntimeJobCoordinator(
      async () =>
        new Promise((resolve) => {
          release = () => resolve(response);
        }),
    );
    const job = coordinator.submit(request);
    expect(
      coordinator.getForAoi({
        type: "administrative_selection",
        unit_ids: ["county_rybnicki", "county_rybnik_city"],
      }),
    ).toMatchObject({ job_id: job.job_id, state: "queued" });
    release?.();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(coordinator.getForAoi(request.aoi)).toBeUndefined();
  });

  it("reuses a completed public-demo job throughout the explicit 24-hour cooldown", async () => {
    let calls = 0;
    const coordinator = createRuntimeJobCoordinator(async () => {
      calls += 1;
      return response;
    });
    const first = coordinator.submit(request, {
      reuseSucceededWithinMs: PUBLIC_DEMO_REFRESH_COOLDOWN_MS,
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const completed = coordinator.get(first.job_id);
    expect(completed).toMatchObject({ state: "succeeded", result: response });

    const repeated = coordinator.submit(request, {
      reuseSucceededWithinMs: PUBLIC_DEMO_REFRESH_COOLDOWN_MS,
    });
    expect(repeated.job_id).toBe(first.job_id);
    expect(calls).toBe(1);
  });

  it("retries a completed job when its publication contains failed domains", async () => {
    let calls = 0;
    const partialResponse = providerRuntimeResponseSchema.parse({
      ...response,
      outcomes: [
        {
          domain: "power",
          source_registry_id: "openstreetmap",
          source_role: "analytical",
          output_kind: "analytical_vector",
          query_version: "fixture/v1",
          tags: {},
          status: "ready",
          detail: "Published",
          failure_reason: null,
          artifact_aoi_id: "aoi_fixture",
          cache_status: "fresh",
          queried_feature_count: 1,
          accepted_feature_count: 1,
          derived_feature_count: 0,
        },
        {
          domain: "water",
          source_registry_id: "openstreetmap",
          source_role: "analytical",
          output_kind: "analytical_vector",
          query_version: "fixture/v1",
          tags: {},
          status: "failed",
          detail: "Timed out",
          failure_reason: "timeout",
          artifact_aoi_id: null,
          cache_status: "missing",
          queried_feature_count: null,
          accepted_feature_count: null,
          derived_feature_count: null,
        },
      ],
    });
    const coordinator = createRuntimeJobCoordinator(async () => {
      calls += 1;
      return partialResponse;
    });
    const first = coordinator.submit(request, {
      reuseSucceededWithinMs: PUBLIC_DEMO_REFRESH_COOLDOWN_MS,
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(
      coordinator
        .get(first.job_id)
        ?.result?.outcomes.some((outcome) => outcome.status === "failed"),
    ).toBe(true);

    const retry = coordinator.submit(request, {
      reuseSucceededWithinMs: PUBLIC_DEMO_REFRESH_COOLDOWN_MS,
    });
    expect(retry.job_id).not.toBe(first.job_id);
    expect(calls).toBe(2);
  });

  it("caches the administrative catalog promise and reuses it on subsequent calls", async () => {
    const service = await import("./aoiRuntimeService.js");
    service.resetAdministrativeCatalogCache();
    let calls = 0;
    const fetcher = async () => {
      calls += 1;
      return { stdout: JSON.stringify({ units: [] }) };
    };
    const first = await service.getAdministrativeCatalog(fetcher);
    const second = await service.getAdministrativeCatalog(fetcher);
    expect(first).toEqual({ units: [] });
    expect(first).toBe(second);
    expect(calls).toBe(1);
  });

  it("evicts the cached catalog promise on error so a subsequent attempt can succeed", async () => {
    const service = await import("./aoiRuntimeService.js");
    service.resetAdministrativeCatalogCache();
    let attempts = 0;
    const flakyFetcher = async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error("Temporary Python worker failure");
      }
      return { stdout: JSON.stringify({ units: ["recovered"] }) };
    };

    await expect(service.getAdministrativeCatalog(flakyFetcher)).rejects.toThrow(
      "Administrative catalogue could not be read.",
    );
    const recovered = await service.getAdministrativeCatalog(flakyFetcher);
    expect(recovered).toEqual({ units: ["recovered"] });
    expect(attempts).toBe(2);
  });
});
