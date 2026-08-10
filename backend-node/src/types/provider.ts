import { z } from "zod";

export const providerIdentifierSchema = z.string().regex(/^[a-z0-9_]+$/);
export const sourceTypeSchema = z.enum(["analytical_vector", "manual_seed", "reference_overlay"]);

export const aoiCircleInputSchema = z.object({
  type: z.literal("circle"),
  longitude: z.number().finite().min(-180).max(180),
  latitude: z.number().finite().min(-90).max(90),
  radius_m: z.number().finite().min(100).max(100_000),
}).strict();

export const administrativeAoiReferenceInputSchema = z.object({
  type: z.literal("administrative_reference"),
  reference_id: z.string().min(1),
}).strict();

export const aoiInputSchema = z.union([aoiCircleInputSchema, administrativeAoiReferenceInputSchema]);

const runtimePointRadiusAoiSchema = z.object({
  type: z.literal("point_radius"), longitude: z.number().finite(), latitude: z.number().finite(), radius_m: z.number().finite(),
}).strict();
const runtimeAdministrativeAoiSchema = z.object({
  type: z.literal("administrative_selection"), unit_ids: z.array(providerIdentifierSchema).min(1),
}).strict();
export const runtimeAoiInputSchema = z.union([runtimePointRadiusAoiSchema, runtimeAdministrativeAoiSchema]);
export const runtimeProfileSchema = z.enum(["power", "emergency", "public", "transport", "bridges", "water", "gas", "sewer", "industrial", "telecom", "district_heating"]);
export const providerRuntimeRequestSchema = z.object({
  aoi: runtimeAoiInputSchema,
  profiles: z.array(runtimeProfileSchema).min(1),
}).strict();
const runtimeGeometrySchema = z.object({
  type: z.enum(["Polygon", "MultiPolygon"]), coordinates: z.unknown(),
}).strict();
const runtimeResolvedAoiSchema = z.object({
  aoi_contract_version: z.literal("provider_aoi/v1"), aoi_id: providerIdentifierSchema, cache_key: providerIdentifierSchema,
  geometry: runtimeGeometrySchema, geometry_crs: z.literal("EPSG:4326"), input_type: z.enum(["circle", "administrative_selection"]),
  source_crs: z.string().min(1), boundary_provenance: z.record(z.string(), z.unknown()), constraints: z.record(z.string(), z.number().positive()), aliases: z.array(providerIdentifierSchema),
}).strict();
export const providerRuntimeResponseSchema = z.object({
  status: z.literal("ok"), request_contract_version: z.literal("provider_aoi_request/v2"), request_id: providerIdentifierSchema,
  cache_key: providerIdentifierSchema, aoi: runtimeResolvedAoiSchema, pipeline_version: z.string().min(1), job_state: z.literal("ready"), request_result: z.enum(["cache", "refresh"]), cached_at: z.string().datetime(),
  profiles: z.array(z.object({ domain: runtimeProfileSchema, source_registry_id: z.string().min(1), source_role: z.enum(["analytical", "reference", "review"]), output_kind: z.enum(["analytical_vector", "reference_descriptor", "derived_context"]), query_version: z.string().min(1), tags: z.record(z.string(), z.array(z.string())) }).strict()),
  outcomes: z.array(z.object({ domain: runtimeProfileSchema, source_registry_id: z.string().min(1), source_role: z.enum(["analytical", "reference", "review"]), output_kind: z.enum(["analytical_vector", "reference_descriptor", "derived_context"]), query_version: z.string().min(1), tags: z.record(z.string(), z.array(z.string())), status: z.enum(["ready", "needs_source", "reference_only", "pending_qualification"]), detail: z.string().min(1), artifact_aoi_id: providerIdentifierSchema.nullable(), cache_status: z.enum(["fresh", "missing"]), queried_feature_count: z.number().int().nonnegative().nullable(), accepted_feature_count: z.number().int().nonnegative().nullable(), derived_feature_count: z.number().int().nonnegative().nullable() }).strict()),
  contexts: z.array(z.object({ domain: z.enum(["administrative", "power", "emergency", "public", "transport", "bridges", "water", "gas", "sewer", "industrial", "telecom", "district_heating"]), source_registry_id: z.string().min(1), output_kind: z.enum(["official_context", "topographic_context", "reference_descriptor", "derived_context"]), status: z.enum(["ready", "needs_source", "reference_only", "pending_qualification"]), detail: z.string().min(1) }).strict()),
}).strict();
export const administrativeCatalogResponseSchema = z.object({
  catalog_version: z.literal("prg_administrative_catalog/v1"), source_registry_id: z.literal("prg_wfs"), snapshot_at: z.string().datetime(), source_crs: z.literal("EPSG:4326"), limitations: z.array(z.string()),
  units: z.array(z.object({ id: providerIdentifierSchema, kind: z.enum(["voivodeship", "county", "gmina"]), name: z.string().min(1), prg_id: z.string().min(1), geometry: runtimeGeometrySchema }).strict()),
}).strict();

export const resolvedAoiSchema = z.object({
  aoi_contract_version: z.literal("provider_aoi/v1"),
  aoi_id: providerIdentifierSchema,
  cache_key: providerIdentifierSchema,
  geometry: z.object({
    type: z.literal("Polygon"),
    coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))).min(1),
  }),
  geometry_crs: z.literal("EPSG:4326"),
  input_type: z.enum(["circle", "administrative_reference"]),
  source_crs: z.string().min(1),
  boundary_provenance: z.record(z.string(), z.unknown()),
  constraints: z.object({
    max_area_sq_m: z.number().positive(),
    min_radius_m: z.number().positive(),
    max_radius_m: z.number().positive(),
    radius_m: z.number().positive().optional(),
  }),
  aliases: z.array(providerIdentifierSchema),
});

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
    geojson_contract_version: z.literal("provider_geojson/v1"),
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
    eligible_for_analysis: z.boolean(),
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
    geojson_contract_version: z.literal("provider_geojson/v1"),
    contract_version: z.literal("provider_geojson/v1"),
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
    eligible_for_analysis: z.boolean(),
    readiness: z.enum(["ready", "usable_with_limitations", "needs_source", "not_usable"]),
    feature_count: z.number().int().nonnegative(),
  })
  .passthrough();

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
    eligible_for_analysis: z.boolean(),
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
export const sourceAccessMethodSchema = z.enum(["public_query", "public_service", "public_download", "free_registration", "local_review_input", "paid", "agreement_only", "private_partner"]);
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
  eligible_for_analysis: z.boolean(),
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
  if (["paid", "agreement_only", "private_partner"].includes(source.access_method) && source.qualification === "qualified_free") {
    context.addIssue({ code: "custom", message: "Restricted access source cannot be qualified free." });
  }
  if (source.usage_role === "analytical" && source.data_kind === "rendered_imagery") {
    context.addIssue({ code: "custom", message: "Rendered imagery cannot be analytical data." });
  }
  if (source.usage_role !== "analytical" && source.eligible_for_analysis) {
    context.addIssue({ code: "custom", message: "Only analytical sources can be eligible for analysis." });
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

export const sourceAvailabilityEntrySchema = z.object({
  source_id: z.string().min(1), availability: z.enum(["available", "unavailable", "not_eligible", "reference_only"]),
  aoi_coverage: z.enum(["covered", "uncovered", "not_applicable"]), feature_state: z.enum(["available", "empty", "not_applicable"]),
  evidence_timestamp: z.string().datetime(), fresh_after_days: z.number().int().positive(), evidence: z.string().min(1),
  freshness: z.enum(["fresh", "stale"]), eligibility: z.enum(["allowed", "rejected", "not_comparable"]), actionable_gap: z.boolean(),
}).strict();
export const sourceAvailabilityReportSchema = z.object({
  report_version: z.literal("provider_source_availability/v1"), aoi_id: providerIdentifierSchema, evidence_timestamp: z.string().datetime(), sources: z.array(sourceAvailabilityEntrySchema).min(1),
}).strict();

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

const analyticalDomainPackArtifactSchema = domainPackArtifactSchema
  .extend({
    kind: z.enum(["processed_vector", "derived_vector", "representative_points"]),
    format: z.literal("geojson"),
    path: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    public_export: z.literal(true),
  })
  .strict();

export const domainPackLayerSchema = z
  .object({
    artifact: analyticalDomainPackArtifactSchema,
    layer: providerLayerResponseSchema,
  })
  .strict();

export const domainPackReadResponseSchema = z
  .object({
    response_version: z.literal("provider_domain_pack_read/v2"),
    aoi_id: providerIdentifierSchema,
    domain: providerIdentifierSchema,
    source_provenance: z.array(sourceProvenanceSchema).min(1),
    validation: cachedMetadataSchema,
    readiness: readinessRecordSchema,
    layers: z.array(domainPackLayerSchema),
    sources: z.array(sourceRegistryV2EntrySchema),
  })
  .strict();

export const domainPackListResponseSchema = z
  .object({
    response_version: z.literal("provider_domain_pack_list/v2"),
    aoi_id: providerIdentifierSchema,
    domain_packs: z.array(domainPackReadResponseSchema),
  })
  .strict();

export const domainExportOutcomeSchema = z
  .object({
    domain: runtimeProfileSchema,
    status: z.enum(["ready", "needs_source", "failed"]),
    detail: z.string().min(1),
    has_domain_pack: z.boolean(),
  })
  .strict();

export const multiDomainExportResponseSchema = z
  .object({
    export_version: z.literal("provider_multi_domain_export/v2"),
    aoi_id: providerIdentifierSchema,
    exported_at: z.string().datetime(),
    domain_outcomes: z.array(domainExportOutcomeSchema),
    domain_packs: z.array(domainPackReadResponseSchema),
    issues: z.array(reviewedIssueSchema),
  })
  .strict();

const presentationBoundsSchema = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]).refine(([minLon, minLat, maxLon, maxLat]) => minLon < maxLon && minLat < maxLat, {
  message: "Presentation bounds must have a positive extent.",
});

export const mapPresentationLayerSchema = z.object({
  artifact_id: z.string().min(1),
  source_layer: z.string().regex(/^[a-z0-9_]+$/),
  feature_count: z.number().int().nonnegative(),
  source: z.string().min(1),
  confidence: z.enum(["high", "medium", "low", "not_applicable"]),
  readiness: z.enum(["ready", "usable_with_limitations", "needs_source", "not_usable"]),
  limitations: z.array(z.string()),
  attribution: z.string().min(1),
  source_provenance: z.array(sourceProvenanceSchema).min(1),
}).strict();

export const mapPresentationManifestSchema = z.object({
  presentation_version: z.literal("provider_map_presentation/v1"),
  aoi_id: providerIdentifierSchema,
  domain: providerIdentifierSchema,
  parent_domain_pack: z.object({
    version: z.literal("provider_domain_pack/v2"),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict(),
  archive: z.object({
    format: z.literal("pmtiles"),
    path: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    size_bytes: z.number().int().positive(),
    min_zoom: z.number().int().min(0).max(22),
    max_zoom: z.number().int().min(0).max(22),
    bounds: presentationBoundsSchema,
  }).strict().refine((archive) => archive.min_zoom <= archive.max_zoom, { message: "Presentation zoom range is invalid." }),
  layers: z.array(mapPresentationLayerSchema).min(1),
  attribution: z.string().min(1),
  benchmark: z.object({
    benchmark_version: z.literal("provider_map_presentation_benchmark/v1"),
    baseline: z.object({ delivery: z.literal("full_geojson_to_leaflet"), feature_count: z.number().int().nonnegative(), payload_bytes: z.number().int().positive() }).strict(),
    presentation: z.object({ delivery: z.literal("pmtiles_mvt_range_reads"), archive_bytes: z.number().int().positive(), addressed_tiles: z.number().int().positive(), min_zoom: z.number().int(), max_zoom: z.number().int() }).strict(),
  }).strict(),
}).strict();

export const mapPresentationResponseSchema = mapPresentationManifestSchema.extend({
  response_version: z.literal("provider_map_presentation_read/v1"),
  archive_url: z.string().startsWith("/api/aoi/"),
}).strict();

export const mapPresentationListResponseSchema = z.object({
  response_version: z.literal("provider_map_presentation_list/v1"),
  aoi_id: providerIdentifierSchema,
  presentations: z.array(mapPresentationResponseSchema),
}).strict();

export const mapFeatureDetailResponseSchema = z.object({
  response_version: z.literal("provider_map_feature_detail/v1"),
  aoi_id: providerIdentifierSchema,
  domain: providerIdentifierSchema,
  artifact_id: z.string().min(1),
  source_id: z.string().regex(/^[a-z][a-z0-9_-]*\/[A-Za-z0-9._:-]+$/i),
  feature: z.object({
    type: z.literal("Feature"),
    properties: z.record(z.string(), z.unknown()),
    geometry: z.object({ type: z.string(), coordinates: z.unknown() }).nullable(),
  }),
}).strict();

const osmElementIdentifierSchema = z.string().regex(/^(node|way|relation)\/\d+$/);
const circuitMemberSchema = z.object({
  source_id: osmElementIdentifierSchema,
  role: z.string(),
  availability: z.string().optional(),
  endpoint_evidence: z.object({ start: osmElementIdentifierSchema, end: osmElementIdentifierSchema }).strict().optional(),
  geometry: z.object({
    type: z.literal("LineString"),
    coordinates: z.array(z.tuple([z.number(), z.number()])).min(2),
  }).optional(),
}).strict();
const powerCircuitSchema = z.object({
  relation_id: z.string().regex(/^relation\/\d+$/),
  tags: z.record(z.string(), z.string()),
  aoi_coverage: z.literal("bounded_source_snapshot"),
  limitations: z.array(z.string().min(1)).min(1),
  members: z.array(circuitMemberSchema).min(1),
}).strict();
const powerCircuitSummarySchema = z.object({
  relation_id: z.string().regex(/^relation\/\d+$/),
  tags: z.record(z.string(), z.string()),
  aoi_coverage: z.literal("bounded_source_snapshot"),
  member_count: z.number().int().positive(),
}).strict();
export const powerCircuitEvidencePayloadSchema = z.object({
  relation_evidence_version: z.literal("osm_power_relation_evidence/v2"),
  source: z.literal("OpenStreetMap"),
  snapshot_at: z.string().datetime(),
  bbox: z.array(z.number().finite()).length(4),
  source_checksum: z.string().regex(/^[a-f0-9]{64}$/),
  relations: z.array(powerCircuitSchema),
  reverse_member_index: z.record(z.string(), z.array(z.string().regex(/^relation\/\d+$/))),
}).strict();
export const mapCircuitListResponseSchema = z.object({
  response_version: z.literal("provider_map_circuit_list/v1"),
  aoi_id: providerIdentifierSchema,
  domain: providerIdentifierSchema,
  source_id: osmElementIdentifierSchema,
  state: z.enum(["available", "not_applicable"]),
  circuits: z.array(powerCircuitSummarySchema),
}).strict();
export const mapCircuitDetailResponseSchema = z.object({
  response_version: z.literal("provider_map_circuit_detail/v1"),
  aoi_id: providerIdentifierSchema,
  domain: providerIdentifierSchema,
  circuit: powerCircuitSchema,
}).strict();

export type CachedMetadata = z.infer<typeof cachedMetadataSchema>;
export type ProviderLayerResponse = z.infer<typeof providerLayerResponseSchema>;
export type ReadinessRecord = z.infer<typeof readinessRecordSchema>;
export type SourceRegistry = z.infer<typeof sourceRegistrySchema>;
export type SourceRegistryV2 = z.infer<typeof sourceRegistryV2Schema>;
export type DomainPackReadResponse = z.infer<typeof domainPackReadResponseSchema>;
export type DomainPackLayer = z.infer<typeof domainPackLayerSchema>;
export type MultiDomainExportResponse = z.infer<typeof multiDomainExportResponseSchema>;
export type MapPresentationManifest = z.infer<typeof mapPresentationManifestSchema>;
export type MapPresentationResponse = z.infer<typeof mapPresentationResponseSchema>;
export type MapFeatureDetailResponse = z.infer<typeof mapFeatureDetailResponseSchema>;
export type MapCircuitListResponse = z.infer<typeof mapCircuitListResponseSchema>;
export type MapCircuitDetailResponse = z.infer<typeof mapCircuitDetailResponseSchema>;
export type GeneratedIssue = z.infer<typeof generatedIssueSchema>;
export type IssueReviewRecord = z.infer<typeof issueReviewRecordSchema>;
export type ReviewedIssue = z.infer<typeof reviewedIssueSchema>;
export type IssueReviewUpdate = z.infer<typeof issueReviewUpdateSchema>;
export type ProviderRuntimeRequest = z.infer<typeof providerRuntimeRequestSchema>;
export type ProviderRuntimeResponse = z.infer<typeof providerRuntimeResponseSchema>;
