import type { Geometry } from "geojson";

export type RuntimeCategory =
  | "power"
  | "emergency"
  | "public"
  | "transport"
  | "bridges"
  | "water"
  | "gas"
  | "sewer"
  | "industrial"
  | "telecom"
  | "district_heating";

export type RuntimeAcquisitionMode = "disabled" | "demo_fixed_aoi" | "local_bounded" | "trusted";

export type RuntimeCapability = {
  response_version: "provider_runtime_capability/v1";
  mode: RuntimeAcquisitionMode;
  supports_custom_aoi: boolean;
  demo_template: {
    id: "rybnik_gmina_demo";
    label: string;
    max_radius_m: number;
    max_counties: number;
    generates_pmtiles: boolean;
    profiles: RuntimeCategory[];
  } | null;
};

export type RuntimeAoiInput =
  | { type: "point_radius"; longitude: number; latitude: number; radius_m: number }
  | { type: "administrative_selection"; unit_ids: string[] };

export type AdministrativeUnit = {
  id: string;
  kind: "voivodeship" | "county" | "gmina";
  name: string;
  prg_id: string;
  parent_id: string | null;
};

export type AdministrativeCatalog = {
  catalog_version: "prg_administrative_catalog/v2";
  source_registry_id: "prg_wfs";
  snapshot_at: string;
  source_crs: "EPSG:4326";
  source_url: string;
  limitations: string[];
  units: AdministrativeUnit[];
};

export type ProviderRuntimeResponse = {
  status: "ok";
  request_contract_version: "provider_aoi_request/v2";
  request_id: string;
  cache_key: string;
  pipeline_version: string;
  job_state: "ready";
  request_result: "cache" | "refresh";
  cached_at: string;
  aoi: {
    aoi_id: string;
    geometry: Geometry;
    input_type: "circle" | "administrative_selection";
    constraints: Record<string, number>;
    boundary_provenance: Record<string, unknown>;
  };
  outcomes: Array<{
    domain: RuntimeCategory;
    source_registry_id: string;
    source_role: string;
    output_kind: string;
    query_version: string;
    tags: Record<string, string[]>;
    status: "ready" | "needs_source" | "reference_only" | "pending_qualification" | "failed";
    detail: string;
    failure_reason: "timeout" | "acquisition_error" | null;
    artifact_aoi_id: string | null;
    cache_status: "fresh" | "missing";
    queried_feature_count: number | null;
    accepted_feature_count: number | null;
    derived_feature_count: number | null;
  }>;
  contexts: Array<{
    domain: RuntimeCategory | "administrative";
    source_registry_id: string;
    output_kind: string;
    status: "ready" | "needs_source" | "reference_only" | "pending_qualification";
    detail: string;
  }>;
};

export type AdministrativeBoundary = {
  response_version: "provider_administrative_boundary/v1";
  aoi: ProviderRuntimeResponse["aoi"];
  metric_area_sq_m: number;
  within_provider_area_limit: boolean;
  message: string;
};

export type RuntimePreflight = {
  response_version: "provider_aoi_preflight/v1";
  status: "ready" | "blocked";
  code: "bounded_provider_request" | "aoi_area_limit";
  message: string;
  aoi: ProviderRuntimeResponse["aoi"];
  metric_area_sq_m: number;
};

export type ProviderRuntimeJob = {
  job_id: string;
  state: "queued" | "running" | "succeeded" | "failed";
  event:
    | "queued"
    | "cache_hit"
    | "started"
    | "domain_started"
    | "domain_completed"
    | "domain_building"
    | "published"
    | "failed";
  total_domains: number;
  completed_domains: number;
  active_domain: RuntimeCategory | null;
  queried_feature_count: number;
  accepted_feature_count: number;
  derived_feature_count: number;
  started_at: string;
  updated_at: string;
  partial_result?: ProviderRuntimeResponse;
  result?: ProviderRuntimeResponse;
  error?: string;
};
