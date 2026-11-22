import { z } from "zod";

import { providerIdentifierSchema, runtimeAoiInputSchema } from "./common.js";

export const runtimeProfileSchema = z.enum([
  "power",
  "emergency",
  "public",
  "transport",
  "bridges",
  "water",
  "gas",
  "sewer",
  "industrial",
  "telecom",
  "district_heating",
]);

export const providerRuntimeRequestSchema = z
  .object({
    aoi: runtimeAoiInputSchema,
    profiles: z.array(runtimeProfileSchema).min(1),
  })
  .strict();

export const runtimeAcquisitionModeSchema = z.enum([
  "disabled",
  "demo_fixed_aoi",
  "local_bounded",
  "trusted",
]);

export const runtimeCapabilityResponseSchema = z
  .object({
    response_version: z.literal("provider_runtime_capability/v1"),
    mode: runtimeAcquisitionModeSchema,
    supports_custom_aoi: z.boolean(),
    demo_template: z
      .object({
        id: z.literal("rybnik_gmina_demo"),
        label: z.string().min(1),
        max_radius_m: z.number().positive(),
        max_counties: z.number().int().positive(),
        generates_pmtiles: z.boolean(),
        profiles: z.array(runtimeProfileSchema).min(1),
      })
      .nullable(),
  })
  .strict();

const runtimeGeometrySchema = z
  .object({
    type: z.enum(["Polygon", "MultiPolygon"]),
    coordinates: z.unknown(),
  })
  .strict();

const runtimeResolvedAoiSchema = z
  .object({
    aoi_contract_version: z.literal("provider_aoi/v1"),
    aoi_id: providerIdentifierSchema,
    cache_key: providerIdentifierSchema,
    geometry: runtimeGeometrySchema,
    geometry_crs: z.literal("EPSG:4326"),
    input_type: z.enum(["circle", "administrative_selection"]),
    source_crs: z.string().min(1),
    boundary_provenance: z.record(z.string(), z.unknown()),
    constraints: z.record(z.string(), z.number().positive()),
    aliases: z.array(providerIdentifierSchema),
  })
  .strict();

export const providerRuntimeResponseSchema = z
  .object({
    status: z.literal("ok"),
    request_contract_version: z.literal("provider_aoi_request/v2"),
    request_id: providerIdentifierSchema,
    cache_key: providerIdentifierSchema,
    aoi: runtimeResolvedAoiSchema,
    pipeline_version: z.string().min(1),
    job_state: z.literal("ready"),
    request_result: z.enum(["cache", "refresh"]),
    cached_at: z.string().datetime(),
    profiles: z.array(
      z
        .object({
          domain: runtimeProfileSchema,
          source_registry_id: z.string().min(1),
          source_role: z.enum(["analytical", "reference", "review"]),
          output_kind: z.enum(["analytical_vector", "reference_descriptor", "derived_context"]),
          query_version: z.string().min(1),
          tags: z.record(z.string(), z.array(z.string())),
        })
        .strict(),
    ),
    outcomes: z.array(
      z
        .object({
          domain: runtimeProfileSchema,
          source_registry_id: z.string().min(1),
          source_role: z.enum(["analytical", "reference", "review"]),
          output_kind: z.enum(["analytical_vector", "reference_descriptor", "derived_context"]),
          query_version: z.string().min(1),
          tags: z.record(z.string(), z.array(z.string())),
          status: z.enum([
            "ready",
            "needs_source",
            "reference_only",
            "pending_qualification",
            "failed",
          ]),
          detail: z.string().min(1),
          failure_reason: z.enum(["timeout", "acquisition_error"]).nullable(),
          artifact_aoi_id: providerIdentifierSchema.nullable(),
          cache_status: z.enum(["fresh", "missing"]),
          queried_feature_count: z.number().int().nonnegative().nullable(),
          accepted_feature_count: z.number().int().nonnegative().nullable(),
          derived_feature_count: z.number().int().nonnegative().nullable(),
          stage_durations_ms: z.record(z.string(), z.number().int().nonnegative()).optional(),
          preparation_duration_ms: z.number().int().nonnegative().nullable().optional(),
          overpass_endpoint: z.string().url().nullable().optional(),
        })
        .strict(),
    ),
    contexts: z.array(
      z
        .object({
          domain: z.enum([
            "administrative",
            "power",
            "emergency",
            "public",
            "transport",
            "bridges",
            "water",
            "gas",
            "sewer",
            "industrial",
            "telecom",
            "district_heating",
          ]),
          source_registry_id: z.string().min(1),
          output_kind: z.enum([
            "official_context",
            "topographic_context",
            "reference_descriptor",
            "derived_context",
          ]),
          status: z.enum(["ready", "needs_source", "reference_only", "pending_qualification"]),
          detail: z.string().min(1),
        })
        .strict(),
    ),
  })
  .strict();

export const providerRuntimeJobSchema = z
  .object({
    job_id: z.string().uuid(),
    state: z.enum(["queued", "running", "succeeded", "failed"]),
    event: z.enum([
      "queued",
      "cache_hit",
      "started",
      "domain_started",
      "domain_completed",
      "domain_building",
      "published",
      "failed",
    ]),
    total_domains: z.number().int().nonnegative(),
    completed_domains: z.number().int().nonnegative(),
    active_domain: runtimeProfileSchema.nullable(),
    queried_feature_count: z.number().int().nonnegative(),
    accepted_feature_count: z.number().int().nonnegative(),
    derived_feature_count: z.number().int().nonnegative(),
    started_at: z.string().datetime(),
    updated_at: z.string().datetime(),
    partial_result: providerRuntimeResponseSchema.optional(),
    result: providerRuntimeResponseSchema.optional(),
    error: z.string().min(1).optional(),
  })
  .strict();

export const administrativeCatalogResponseSchema = z
  .object({
    catalog_version: z.literal("prg_administrative_catalog/v2"),
    source_registry_id: z.literal("prg_wfs"),
    snapshot_at: z.string().datetime(),
    source_crs: z.literal("EPSG:4326"),
    source_url: z.string().url(),
    limitations: z.array(z.string()),
    units: z.array(
      z
        .object({
          id: providerIdentifierSchema,
          kind: z.enum(["voivodeship", "county", "gmina"]),
          name: z.string().min(1),
          prg_id: z.string().min(1),
          parent_id: providerIdentifierSchema.nullable(),
        })
        .strict(),
    ),
  })
  .strict();

export const administrativeBoundaryRequestSchema = z
  .object({ unit_ids: z.array(providerIdentifierSchema).min(1) })
  .strict();

export const administrativeBoundaryResponseSchema = z
  .object({
    response_version: z.literal("provider_administrative_boundary/v1"),
    aoi: runtimeResolvedAoiSchema,
    metric_area_sq_m: z.number().nonnegative(),
    within_provider_area_limit: z.boolean(),
    message: z.string().min(1),
  })
  .strict();

export const providerRuntimePreflightResponseSchema = z
  .object({
    response_version: z.literal("provider_aoi_preflight/v1"),
    status: z.enum(["ready", "blocked"]),
    code: z.enum(["bounded_provider_request", "aoi_area_limit"]),
    message: z.string().min(1),
    aoi: runtimeResolvedAoiSchema,
    metric_area_sq_m: z.number().nonnegative(),
  })
  .strict();

/**
 * Immutable, operator-published description of a regional prepared snapshot.
 * The checksum deliberately covers the canonical manifest without this field,
 * avoiding a self-referential hash while keeping the on-disk contract
 * tamper-evident.
 */
export const preparedSnapshotStateSchema = z.enum([
  "ready",
  "partial",
  "queued",
  "running",
  "failed",
]);

export const preparedSnapshotDomainOutcomeSchema = z
  .object({
    domain: runtimeProfileSchema,
    status: z.enum(["ready", "needs_source", "failed"]),
    detail: z.string().min(1),
    manifest_sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    readiness: z.enum(["ready", "usable_with_limitations", "needs_source", "not_usable"]),
    limitations: z.array(z.string()),
  })
  .strict();

export const preparedSnapshotManifestSchema = z
  .object({
    snapshot_version: z.literal("provider_prepared_snapshot/v1"),
    snapshot_id: providerIdentifierSchema,
    aoi_id: providerIdentifierSchema,
    version: z.string().min(1),
    state: preparedSnapshotStateSchema,
    published_at: z.string().datetime().nullable(),
    source_observed_at: z.string().datetime().nullable(),
    pipeline_version: z.string().min(1),
    coverage: z
      .object({
        geometry: runtimeGeometrySchema,
        geometry_crs: z.literal("EPSG:4326"),
        input_type: z.enum(["circle", "administrative_selection"]),
        source_label: z.string().min(1),
        limitations: z.array(z.string()),
      })
      .strict(),
    domain_outcomes: z.array(preparedSnapshotDomainOutcomeSchema).min(1),
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const preparedSnapshotCatalogueResponseSchema = z
  .object({
    response_version: z.literal("provider_prepared_snapshot_catalogue/v1"),
    snapshots: z.array(preparedSnapshotManifestSchema),
  })
  .strict();

export const aoiAvailabilityRequestSchema = z.object({ aoi: runtimeAoiInputSchema }).strict();

export const aoiAvailabilityResponseSchema = z
  .object({
    response_version: z.literal("provider_aoi_availability/v1"),
    requested_aoi_id: providerIdentifierSchema,
    state: z.enum(["ready", "partial_coverage", "not_prepared", "queued", "running", "failed"]),
    snapshot_ids: z.array(providerIdentifierSchema),
    explanation: z.string().min(1),
    limitations: z.array(z.string()),
  })
  .strict();

export const runtimeAcquisitionEvidenceSchema = z
  .object({
    evidence_version: z.literal("provider_runtime_acquisition_evidence/v1"),
    aoi_id: providerIdentifierSchema,
    snapshot_id: providerIdentifierSchema,
    resolved_geometry: runtimeGeometrySchema,
    radius_m: z.number().positive().nullable(),
    allowed_domains: z.array(runtimeProfileSchema).min(1),
    source_observed_at: z.string().datetime(),
    overpass_endpoint: z.string().url().nullable(),
    pipeline_version: z.string().min(1),
    published_at: z.string().datetime(),
    domains: z.array(
      z
        .object({
          domain: runtimeProfileSchema,
          stage_durations_ms: z.record(z.string(), z.number().int().nonnegative()).optional(),
          preparation_duration_ms: z.number().int().nonnegative().nullable(),
          queried_feature_count: z.number().int().nonnegative().nullable(),
          accepted_feature_count: z.number().int().nonnegative().nullable(),
          rejected_feature_count: z.number().int().nonnegative().nullable(),
          validation_status: z.enum(["passed", "warning", "failed", "unknown"]),
          limitations: z.array(z.string()),
          overpass_endpoint: z.string().url().nullable(),
        })
        .strict(),
    ),
  })
  .strict();

export type AdministrativeBoundaryRequest = z.infer<typeof administrativeBoundaryRequestSchema>;
export type AdministrativeBoundaryResponse = z.infer<typeof administrativeBoundaryResponseSchema>;
export type AoiAvailabilityResponse = z.infer<typeof aoiAvailabilityResponseSchema>;
export type PreparedSnapshotManifest = z.infer<typeof preparedSnapshotManifestSchema>;
export type ProviderRuntimeJob = z.infer<typeof providerRuntimeJobSchema>;
export type ProviderRuntimePreflightResponse = z.infer<
  typeof providerRuntimePreflightResponseSchema
>;
export type ProviderRuntimeRequest = z.infer<typeof providerRuntimeRequestSchema>;
export type ProviderRuntimeResponse = z.infer<typeof providerRuntimeResponseSchema>;
export type RuntimeAcquisitionEvidence = z.infer<typeof runtimeAcquisitionEvidenceSchema>;
export type RuntimeCapabilityResponse = z.infer<typeof runtimeCapabilityResponseSchema>;
