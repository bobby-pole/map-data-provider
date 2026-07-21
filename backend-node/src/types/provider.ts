import { z } from "zod";

export const providerIdentifierSchema = z.string().regex(/^[a-z0-9_]+$/);
export const sourceTypeSchema = z.enum(["analytical_vector", "manual_seed", "reference_overlay"]);

export const providerErrorSchema = z.object({
  error: z.enum(["invalid_request", "not_found", "worker_failed"]),
  message: z.string(),
});

export const cachedMetadataSchema = z
  .object({
    cache_layout_version: z.literal("provider_cache/v1"),
    geojson_contract_version: z.literal("steel_sentinel_geojson/v1"),
    aoi_id: providerIdentifierSchema,
    domain: providerIdentifierSchema,
    layer_id: z.string(),
    source: z.string(),
    source_type: sourceTypeSchema,
    source_registry_id: z.string(),
    source_url: z.string().url(),
    source_query: z.string(),
    snapshot_at: z.string().datetime(),
    pipeline_version: z.string(),
    query_version: z.string(),
    validation_status_raw: z.string(),
    quality_status: z.enum(["passed", "warning", "failed", "unknown"]),
    confidence: z.enum(["high", "medium", "low", "not_applicable"]),
    limitations: z.array(z.string()),
    usable_for_simulation: z.boolean(),
    readiness: z.enum(["ready", "usable_with_limitations", "needs_source", "not_usable"]),
    feature_count: z.number().int().nonnegative(),
  })
  .strict();

export const readinessRecordSchema = z
  .object({
    cache_layout_version: z.literal("provider_cache/v1"),
    aoi_id: providerIdentifierSchema,
    domain: providerIdentifierSchema,
    layer_id: z.string(),
    readiness: z.enum(["ready", "usable_with_limitations", "needs_source", "not_usable"]),
    quality_status: z.enum(["passed", "warning", "failed", "unknown"]),
    highest_issue_severity: z.enum(["low", "medium", "high"]).nullable(),
    feature_count: z.number().int().nonnegative(),
    evaluated_at: z.string().datetime(),
  })
  .strict();

export const providerLayerMetadataSchema = z
  .object({
    cache_layout_version: z.literal("provider_cache/v1"),
    geojson_contract_version: z.literal("steel_sentinel_geojson/v1"),
    contract_version: z.literal("steel_sentinel_geojson/v1"),
    aoi_id: providerIdentifierSchema,
    domain: providerIdentifierSchema,
    layer_id: z.string(),
    source: z.string(),
    source_type: sourceTypeSchema,
    source_query: z.string(),
    snapshot_at: z.string().datetime(),
    validation_status_raw: z.string(),
    quality_status: z.enum(["passed", "warning", "failed", "unknown"]),
    confidence: z.enum(["high", "medium", "low", "not_applicable"]),
    limitations: z.array(z.string()),
    usable_for_simulation: z.boolean(),
    readiness: z.enum(["ready", "usable_with_limitations", "needs_source", "not_usable"]),
    feature_count: z.number().int().nonnegative(),
  })
  .strict();

export const providerLayerResponseSchema = z
  .object({
    type: z.literal("FeatureCollection"),
    metadata: providerLayerMetadataSchema,
    features: z.array(
      z.object({
        type: z.literal("Feature"),
        properties: z.record(z.string(), z.unknown()),
        geometry: z.object({ type: z.string(), coordinates: z.unknown() }).nullable(),
      }),
    ),
  })
  .strict();

export const sourceRegistryEntrySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    source_type: sourceTypeSchema,
    role: z.string(),
    access: z.string(),
    not_authoritative: z.boolean(),
    usable_for_simulation: z.boolean(),
    source_url: z.string(),
    attribution: z.string(),
    license: z.string(),
    license_url: z.string().url().nullable(),
    distribution_guidance: z.string(),
    availability_caveats: z.array(z.string()),
    limitations: z.array(z.string()),
  })
  .passthrough();

export const sourceRegistrySchema = z
  .object({
    registry_version: z.literal("source_registry/v1"),
    sources: z.array(sourceRegistryEntrySchema),
  })
  .strict();

export const layerListResponseSchema = z.object({
  aoi_id: providerIdentifierSchema,
  layers: z.array(cachedMetadataSchema),
});

export const readinessListResponseSchema = z.object({
  aoi_id: providerIdentifierSchema,
  readiness: z.array(readinessRecordSchema),
});

export const sourceListResponseSchema = z.object({
  aoi_id: providerIdentifierSchema,
  registry_version: z.literal("source_registry/v1"),
  sources: z.array(sourceRegistryEntrySchema),
});

export const aoiRequestSchema = z.object({
  aoi_id: providerIdentifierSchema,
  domain: providerIdentifierSchema,
});

export const aoiRequestResponseSchema = z.object({
  aoi: z.object({
    id: z.literal("rybnik_60km"),
    boundary_reference: z.string(),
    crs: z.literal("EPSG:4326"),
    allowed_domains: z.array(z.literal("power")),
  }),
  domain: z.literal("power"),
  cache_status: z.enum(["fresh", "refreshed"]),
  result: z.enum(["cache", "refresh"]),
  metadata: cachedMetadataSchema,
});

export const steelSentinelPackSchema = z.object({
  contract_version: z.literal("steel_sentinel_pack/v1"),
  aoi_id: providerIdentifierSchema,
  domains: z.array(z.literal("power")),
  layers: z.object({
    power: z.object({
      layer: providerLayerResponseSchema,
      metadata: cachedMetadataSchema,
      readiness: readinessRecordSchema,
    }),
  }),
  sources: sourceRegistrySchema,
});

export type CachedMetadata = z.infer<typeof cachedMetadataSchema>;
export type ProviderLayerResponse = z.infer<typeof providerLayerResponseSchema>;
export type ReadinessRecord = z.infer<typeof readinessRecordSchema>;
export type SourceRegistry = z.infer<typeof sourceRegistrySchema>;
