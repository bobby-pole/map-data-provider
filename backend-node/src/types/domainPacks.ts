import { z } from "zod";

import { providerIdentifierSchema, sourceTypeSchema } from "./common.js";
import { reviewedIssueSchema } from "./issues.js";
import { preparedSnapshotManifestSchema, runtimeProfileSchema } from "./runtime.js";
import { sourceProvenanceSchema, sourceRegistryV2EntrySchema } from "./sources.js";

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

export const domainPackArtifactSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum([
      "native_vector",
      "native_raster",
      "remote_service",
      "processed_vector",
      "derived_vector",
      "representative_points",
    ]),
    format: z.string().min(1),
    path: z.string().min(1).optional(),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    feature_count: z.number().int().nonnegative().optional(),
    source_provenance: z.array(sourceProvenanceSchema).min(1),
    public_export: z.boolean(),
    not_applicable_reason: z.string().min(1).optional(),
  })
  .strict();

export const domainPackV2Schema = z
  .object({
    domain_pack_version: z.literal("provider_domain_pack/v2"),
    aoi_id: providerIdentifierSchema,
    domain: providerIdentifierSchema,
    source_provenance: z.array(sourceProvenanceSchema).min(1),
    artifacts: z.array(domainPackArtifactSchema).min(1),
    data_license_notices: z
      .array(
        z
          .object({
            source_id: z.literal("openstreetmap"),
            license: z.literal("ODbL-1.0"),
            license_url: z.literal("https://opendatacommons.org/licenses/odbl/1-0/"),
            attribution: z.literal("© OpenStreetMap contributors"),
            attribution_url: z.literal("https://www.openstreetmap.org/copyright"),
            notice_path: z.literal("licenses/openstreetmap-odbl.md"),
          })
          .strict(),
      )
      .optional(),
    validation: z.object({ path: z.string().min(1) }).strict(),
    readiness: z.object({ path: z.string().min(1) }).strict(),
  })
  .strict()
  .superRefine((pack, context) => {
    const ids = pack.artifacts.map((artifact) => artifact.id);
    if (new Set(ids).size !== ids.length) {
      context.addIssue({ code: "custom", message: "Domain-pack artifact IDs must be unique." });
    }
    for (const artifact of pack.artifacts) {
      if (artifact.kind !== "remote_service" && !artifact.path && !artifact.not_applicable_reason) {
        context.addIssue({
          code: "custom",
          message: "File-backed artifact requires a path or not-applicable reason.",
        });
      }
    }
    const includesPublicOsm = pack.artifacts.some(
      (artifact) =>
        artifact.public_export &&
        artifact.source_provenance.some((record) => record.source_id === "openstreetmap"),
    );
    if (includesPublicOsm && pack.data_license_notices?.length !== 1) {
      context.addIssue({
        code: "custom",
        message: "Public OpenStreetMap artifacts require one ODbL data licence notice.",
      });
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

export const aoiRequestSchema = z.object({
  aoi_id: providerIdentifierSchema,
  domain: providerIdentifierSchema,
});

export const aoiRequestResponseSchema = z.object({
  aoi: z.object({
    id: z.literal("rybnik_35km"),
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
    snapshot: preparedSnapshotManifestSchema,
    exported_at: z.string().datetime(),
    domain_outcomes: z.array(domainExportOutcomeSchema),
    domain_packs: z.array(domainPackReadResponseSchema),
    issues: z.array(reviewedIssueSchema),
  })
  .strict();

export type CachedMetadata = z.infer<typeof cachedMetadataSchema>;
export type DomainPackLayer = z.infer<typeof domainPackLayerSchema>;
export type DomainPackReadResponse = z.infer<typeof domainPackReadResponseSchema>;
export type MultiDomainExportResponse = z.infer<typeof multiDomainExportResponseSchema>;
export type ProviderLayerResponse = z.infer<typeof providerLayerResponseSchema>;
export type ReadinessRecord = z.infer<typeof readinessRecordSchema>;
