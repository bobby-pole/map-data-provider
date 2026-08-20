import { describe, expect, it } from "vitest";

import { aoiInputSchema, mapCircuitListResponseSchema, powerCircuitEvidencePayloadSchema, providerRuntimeRequestSchema, providerRuntimeResponseSchema, resolvedAoiSchema } from "./provider.js";

describe("provider_aoi/v1 contracts", () => {
  it("accepts bounded circle and approved administrative-reference request shapes", () => {
    expect(aoiInputSchema.parse({ type: "circle", longitude: 18.546285, latitude: 50.102174, radius_m: 35_000 })).toMatchObject({ type: "circle" });
    expect(aoiInputSchema.parse({ type: "administrative_reference", reference_id: "prg_gmina_rybnik" })).toMatchObject({ type: "administrative_reference" });
  });

  it("rejects unsafe circles and uncontracted geometry fields", () => {
    expect(() => aoiInputSchema.parse({ type: "circle", longitude: 18.5, latitude: 50.1, radius_m: 0 })).toThrow();
    expect(() => aoiInputSchema.parse({ type: "circle", longitude: 18.5, latitude: 50.1, radius_m: 1_000, cache_key: "../escape" })).toThrow();
  });

  it("validates resolved AOI metadata without accepting an unsafe cache key", () => {
    const resolved = {
      aoi_contract_version: "provider_aoi/v1", aoi_id: "aoi_1234", cache_key: "rybnik_35km",
      geometry: { type: "Polygon", coordinates: [[[18.49, 50.06], [18.64, 50.06], [18.49, 50.06]]] },
      geometry_crs: "EPSG:4326",
      input_type: "administrative_reference", source_crs: "EPSG:4326",
      boundary_provenance: { kind: "prg_reference", reference_id: "prg_gmina_rybnik" },
      constraints: { max_area_sq_m: 31_415_926_535.89793, min_radius_m: 100, max_radius_m: 100_000 }, aliases: ["rybnik_35km"],
    };
    expect(resolvedAoiSchema.parse(resolved).cache_key).toBe("rybnik_35km");
    expect(() => resolvedAoiSchema.parse({ ...resolved, cache_key: "../escape" })).toThrow();
  });

  it("accepts only explicit v2 runtime AOI modes and provider categories", () => {
    expect(providerRuntimeRequestSchema.parse({ aoi: { type: "administrative_selection", unit_ids: ["county_rybnik_city", "county_rybnicki"] }, profiles: ["power", "water"] })).toMatchObject({ profiles: ["power", "water"] });
    expect(() => providerRuntimeRequestSchema.parse({ aoi: { type: "point_radius", longitude: 18.5, latitude: 50.1, radius_m: 1_000 }, profiles: ["unknown"] })).toThrow();
  });

  it("validates an explicit source gap rather than a fabricated vector response", () => {
    expect(providerRuntimeResponseSchema.parse({
      status: "ok", request_contract_version: "provider_aoi_request/v2", request_id: "request_fixture", cache_key: "request_fixture", pipeline_version: "geo_pipeline/runtime/v1", job_state: "ready", request_result: "refresh", cached_at: "2026-08-03T00:00:00Z",
      aoi: { aoi_contract_version: "provider_aoi/v1", aoi_id: "aoi_fixture", cache_key: "aoi_fixture", geometry: { type: "Polygon", coordinates: [] }, geometry_crs: "EPSG:4326", input_type: "circle", source_crs: "EPSG:4326", boundary_provenance: {}, constraints: { max_area_sq_m: 1, min_radius_m: 1, max_radius_m: 1 }, aliases: [] },
      profiles: [{ domain: "water", source_registry_id: "openstreetmap", source_role: "analytical", output_kind: "analytical_vector", query_version: "water-osm/v2", tags: { pipeline: ["water"] } }],
      outcomes: [{ domain: "water", source_registry_id: "openstreetmap", source_role: "analytical", output_kind: "analytical_vector", query_version: "water-osm/v2", tags: { pipeline: ["water"] }, status: "needs_source", failure_reason: null, artifact_aoi_id: null, cache_status: "missing", queried_feature_count: 0, accepted_feature_count: 0, derived_feature_count: 0, detail: "No fixture data." }],
      contexts: [{ domain: "water", source_registry_id: "kiut_gesut_wms", output_kind: "reference_descriptor", status: "reference_only", detail: "Rendered reference." }],
    })).toMatchObject({ outcomes: [{ domain: "water", status: "needs_source" }] });
  });

  it("keeps unavailable circuit enrichment explicit so a targeted recovery can be attempted", () => {
    const unavailableEvidence = powerCircuitEvidencePayloadSchema.parse({
      relation_evidence_version: "osm_power_relation_evidence/v2", source: "OpenStreetMap", snapshot_at: "2026-08-14T15:53:33.572Z", bbox: [18.4, 50, 18.6, 50.2],
      source_checksum: null, relations: [], reverse_member_index: {}, availability: "unavailable", limitations: ["The initial bounded relation request was rate limited."],
    });
    expect("availability" in unavailableEvidence && unavailableEvidence.availability).toBe("unavailable");
    expect(mapCircuitListResponseSchema.parse({ response_version: "provider_map_circuit_list/v1", aoi_id: "aoi_fixture", domain: "power", source_id: "way/1", state: "unavailable", circuits: [], limitations: ["Targeted recovery was unavailable."] }).state).toBe("unavailable");
  });
});
