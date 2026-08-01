import { z } from "zod";

export const providerIdentifierSchema = z.string().regex(/^[a-z0-9_]+$/);
export const sourceTypeSchema = z.enum(["analytical_vector", "manual_seed", "reference_overlay"]);

export const providerErrorSchema = z.object({
  error: z.enum(["invalid_request", "not_found", "conflict", "worker_failed"]),
  message: z.string(),
});

export const issueReviewStatusSchema = z.enum(["open", "acknowledged", "resolved", "accepted", "ignored"]);

export const generatedIssueSchema = z
  .object({
    id: z.string().min(1),
    rule_id: z.string().min(1),
    rule_version: z.string().min(1),
    severity: z.enum(["low", "medium", "high"]),
    source_type: sourceTypeSchema,
    domain: providerIdentifierSchema,
    layer_id: z.string().min(1),
    affected_object: z.object({ type: z.string().min(1), id: z.string().min(1) }).strict(),
    category: z.string().min(1),
    title: z.string().min(1),
    evidence: z.string().min(1),
    recommendation: z.string().min(1),
  })
  .strict();

export const generatedIssueSnapshotSchema = z
  .object({
    issue_snapshot_version: z.literal("provider_issues/v1"),
    aoi_id: providerIdentifierSchema,
    issues: z.array(generatedIssueSchema),
  })
  .strict();

export const issueReviewRecordSchema = z
  .object({
    aoi_id: providerIdentifierSchema,
    issue_id: z.string().min(1),
    rule_id: z.string().min(1),
    rule_version: z.string().min(1),
    layer_id: z.string().min(1),
    status: issueReviewStatusSchema.exclude(["open"]),
    note: z.string().max(1000).nullable(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  })
  .strict();

export const issueReviewStoreSchema = z
  .object({
    review_store_version: z.literal("provider_issue_reviews/v1"),
    reviews: z.array(issueReviewRecordSchema),
  })
  .strict();

export const issueReviewSchema = z
  .object({
    status: issueReviewStatusSchema,
    note: z.string().nullable(),
    created_at: z.string().datetime().nullable(),
    updated_at: z.string().datetime().nullable(),
  })
  .strict();

export const reviewedIssueSchema = generatedIssueSchema.extend({ review: issueReviewSchema }).strict();

export const issueListResponseSchema = z.object({
  aoi_id: providerIdentifierSchema,
  issues: z.array(reviewedIssueSchema),
});

export const issueReviewUpdateSchema = z
  .object({
    status: issueReviewStatusSchema.exclude(["open"]),
    note: z.string().trim().max(1000).nullable().optional(),
    expected_updated_at: z.string().datetime().nullable(),
  })
  .strict();

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

export const sourceRegistryV1EntrySchema = z
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
    sources: z.array(sourceRegistryV1EntrySchema),
  })
  .strict();

export const sourceDataKindSchema = z.enum(["vector", "raster", "rendered_imagery"]);
export const sourceFormatSchema = z.enum(["geojson", "osm_query", "wfs_gml", "gpkg_geoparquet", "wms", "wmts", "geotiff_ascii_grid"]);
export const sourceAuthoritySchema = z.enum(["community", "official", "project_local"]);
export const sourceAccessMethodSchema = z.enum(["public_query", "public_service", "public_download", "local_review_input"]);
export const sourceUsageRoleSchema = z.enum(["analytical", "reference", "review"]);
export const sourceQualificationSchema = z.enum(["qualified_free", "pending_qualification", "rejected"]);
export const sourceDistributionSchema = z.object({
  public_export: z.enum(["allowed", "prohibited"]),
  reason: z.string().min(1),
}).strict();
export const sourceProvenanceSchema = z.object({
  source_id: z.string().min(1),
  contribution_role: z.enum(["primary", "supplementary", "validation_reference", "derived_context"]),
}).strict();

const sourceFormatDataKind = {
  geojson: "vector",
  osm_query: "vector",
  wfs_gml: "vector",
  gpkg_geoparquet: "vector",
  wms: "rendered_imagery",
  wmts: "rendered_imagery",
  geotiff_ascii_grid: "raster",
} as const;

export const sourceRegistryV2EntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  data_kind: sourceDataKindSchema,
  format: sourceFormatSchema,
  authority: sourceAuthoritySchema,
  access_method: sourceAccessMethodSchema,
  usage_role: sourceUsageRoleSchema,
  qualification: sourceQualificationSchema,
  distribution: sourceDistributionSchema,
  not_authoritative: z.boolean(),
  usable_for_simulation: z.boolean(),
  source_url: z.string().min(1),
  attribution: z.string().min(1),
  license: z.string().min(1),
  license_url: z.string().url().nullable(),
  availability_caveats: z.array(z.string()),
  limitations: z.array(z.string()),
  cache_provenance: z.object({ required_fields: z.array(z.string().min(1)).min(1) }).strict().optional(),
}).strict().superRefine((source, context) => {
  if (source.data_kind !== sourceFormatDataKind[source.format]) {
    context.addIssue({ code: "custom", message: "Source data kind contradicts its format." });
  }
  if (source.usage_role === "analytical" && source.data_kind === "rendered_imagery") {
    context.addIssue({ code: "custom", message: "Rendered imagery cannot be analytical data." });
  }
  if (source.usage_role !== "analytical" && source.usable_for_simulation) {
    context.addIssue({ code: "custom", message: "Only analytical sources may be simulation inputs." });
  }
  if (source.usage_role !== "analytical" && source.distribution.public_export !== "prohibited") {
    context.addIssue({ code: "custom", message: "Reference or review sources cannot enter public analytical export." });
  }
  if (source.qualification !== "qualified_free" && source.distribution.public_export !== "prohibited") {
    context.addIssue({ code: "custom", message: "Unqualified sources cannot enter public export." });
  }
  if (source.distribution.public_export === "allowed" && source.not_authoritative) {
    context.addIssue({ code: "custom", message: "Non-authoritative sources cannot enter public analytical export." });
  }
  if (source.usage_role === "analytical" && source.data_kind === "vector" && source.qualification === "qualified_free" && !source.cache_provenance) {
    context.addIssue({ code: "custom", message: "Analytical vector sources require cache provenance." });
  }
});

export const sourceRegistryV2Schema = z.object({
  registry_version: z.literal("source_registry/v2"),
  sources: z.array(sourceRegistryV2EntrySchema).min(1),
}).strict().superRefine((registry, context) => {
  const sourceIds = registry.sources.map((source) => source.id);
  if (new Set(sourceIds).size !== sourceIds.length) {
    context.addIssue({ code: "custom", message: "Source registry IDs must be unique." });
  }
  for (const requiredId of ["openstreetmap", "prg_wfs", "bdot10k", "kiut_gesut_wms", "geoportal_orthophoto", "nmt_nmpt"]) {
    if (!sourceIds.includes(requiredId)) {
      context.addIssue({ code: "custom", message: `Source registry v2 is missing required source family: ${requiredId}.` });
    }
  }
});

export function isPublicExportEligible(source: z.infer<typeof sourceRegistryV2EntrySchema>): boolean {
  return source.distribution.public_export === "allowed"
    && source.qualification === "qualified_free"
    && source.usage_role === "analytical"
    && source.data_kind !== "rendered_imagery";
}

export function validateOrderedSourceProvenance(
  provenance: z.infer<typeof sourceProvenanceSchema>[],
  registry: z.infer<typeof sourceRegistryV2Schema>,
  publicExport: boolean,
): void {
  if (provenance.length === 0) throw new Error("Ordered provenance must contain at least one source.");
  const sourceIds = new Set<string>();
  for (const record of provenance) {
    const parsed = sourceProvenanceSchema.parse(record);
    if (sourceIds.has(parsed.source_id)) throw new Error("Ordered provenance source IDs must be unique.");
    const source = registry.sources.find((candidate) => candidate.id === parsed.source_id);
    if (!source) throw new Error(`Unknown source registry ID: ${parsed.source_id}.`);
    if (publicExport && !isPublicExportEligible(source)) throw new Error(`Source ${parsed.source_id} is not eligible for public export.`);
    sourceIds.add(parsed.source_id);
  }
}

export const domainPackArtifactSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["native_vector", "native_raster", "remote_service", "processed_vector", "derived_vector", "representative_points"]),
  format: z.string().min(1),
  path: z.string().min(1).optional(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  feature_count: z.number().int().nonnegative().optional(),
  source_provenance: z.array(sourceProvenanceSchema).min(1),
  public_export: z.boolean(),
  not_applicable_reason: z.string().min(1).optional(),
}).strict();

export const domainPackV2Schema = z.object({
  domain_pack_version: z.literal("provider_domain_pack/v2"),
  aoi_id: providerIdentifierSchema,
  domain: providerIdentifierSchema,
  source_provenance: z.array(sourceProvenanceSchema).min(1),
  artifacts: z.array(domainPackArtifactSchema).min(1),
  validation: z.object({ path: z.string().min(1) }).strict(),
  readiness: z.object({ path: z.string().min(1) }).strict(),
}).strict().superRefine((pack, context) => {
  const ids = pack.artifacts.map((artifact) => artifact.id);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", message: "Domain-pack artifact IDs must be unique." });
  for (const artifact of pack.artifacts) {
    if (artifact.kind !== "remote_service" && !artifact.path && !artifact.not_applicable_reason) {
      context.addIssue({ code: "custom", message: "File-backed artifact requires a path or not-applicable reason." });
    }
  }
});

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
  sources: z.array(sourceRegistryV1EntrySchema),
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
export type SourceRegistryV2 = z.infer<typeof sourceRegistryV2Schema>;
export type GeneratedIssue = z.infer<typeof generatedIssueSchema>;
export type IssueReviewRecord = z.infer<typeof issueReviewRecordSchema>;
export type ReviewedIssue = z.infer<typeof reviewedIssueSchema>;
export type IssueReviewUpdate = z.infer<typeof issueReviewUpdateSchema>;
