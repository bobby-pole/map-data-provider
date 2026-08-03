import { describe, expect, it } from "vitest";

import { createRuntimeRequestCoordinator } from "./aoiRuntimeService.js";
import { type ProviderRuntimeRequest, providerRuntimeResponseSchema } from "../types/provider.js";

const request: ProviderRuntimeRequest = { aoi: { type: "administrative_selection", unit_ids: ["county_rybnik_city", "county_rybnicki"] }, profiles: ["power", "water"] };
const response = providerRuntimeResponseSchema.parse({
  status: "ok", request_contract_version: "provider_aoi_request/v2", request_id: "request_fixture", cache_key: "request_fixture", pipeline_version: "fixture/v1", job_state: "ready", request_result: "refresh", cached_at: "2026-08-03T00:00:00Z",
  aoi: { aoi_contract_version: "provider_aoi/v1", aoi_id: "aoi_fixture", cache_key: "aoi_fixture", geometry: { type: "Polygon", coordinates: [] }, geometry_crs: "EPSG:4326", input_type: "administrative_selection", source_crs: "EPSG:4326", boundary_provenance: {}, constraints: { max_area_sq_m: 1, min_radius_m: 1, max_radius_m: 1 }, aliases: [] },
  profiles: [],
  outcomes: [], contexts: [],
});

describe("runtime request coordinator", () => {
  it("coalesces equivalent in-progress requests despite input ordering", async () => {
    let calls = 0;
    let release: (() => void) | undefined;
    const coordinator = createRuntimeRequestCoordinator(async () => {
      calls += 1;
      await new Promise<void>((resolve) => { release = resolve; });
      return response;
    });
    const first = coordinator.submit(request);
    const equivalent = coordinator.submit({ aoi: { type: "administrative_selection", unit_ids: ["county_rybnicki", "county_rybnik_city"] }, profiles: ["water", "power"] });
    expect(calls).toBe(1);
    release?.();
    await expect(Promise.all([first, equivalent])).resolves.toEqual([response, response]);
  });
});
