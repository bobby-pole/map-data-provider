import { z } from "zod";

import { providerIdentifierSchema, sourceTypeSchema } from "./common.js";

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
export const sourceFormatSchema = z.enum([
  "geojson",
  "osm_query",
  "wfs_gml",
  "gpkg_geoparquet",
  "wms",
  "wmts",
  "geotiff_ascii_grid",
]);
export const sourceAuthoritySchema = z.enum(["community", "official", "project_local"]);
export const sourceAccessMethodSchema = z.enum([
  "public_query",
  "public_service",
  "public_download",
  "free_registration",
  "local_review_input",
  "paid",
  "agreement_only",
  "private_partner",
]);
export const sourceUsageRoleSchema = z.enum(["analytical", "reference", "review"]);
export const sourceQualificationSchema = z.enum([
  "qualified_free",
  "pending_qualification",
  "rejected",
]);
export const sourceDistributionSchema = z
  .object({
    public_export: z.enum(["allowed", "prohibited"]),
    reason: z.string().min(1),
  })
  .strict();
export const sourceProvenanceSchema = z
  .object({
    source_id: z.string().min(1),
    contribution_role: z.enum([
      "primary",
      "supplementary",
      "validation_reference",
      "derived_context",
    ]),
  })
  .strict();

const sourceFormatDataKind = {
  geojson: "vector",
  osm_query: "vector",
  wfs_gml: "vector",
  gpkg_geoparquet: "vector",
  wms: "rendered_imagery",
  wmts: "rendered_imagery",
  geotiff_ascii_grid: "raster",
} as const;

export const sourceRegistryV2EntrySchema = z
  .object({
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
    cache_provenance: z
      .object({ required_fields: z.array(z.string().min(1)).min(1) })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((source, context) => {
    if (source.data_kind !== sourceFormatDataKind[source.format]) {
      context.addIssue({ code: "custom", message: "Source data kind contradicts its format." });
    }
    if (
      ["paid", "agreement_only", "private_partner"].includes(source.access_method) &&
      source.qualification === "qualified_free"
    ) {
      context.addIssue({
        code: "custom",
        message: "Restricted access source cannot be qualified free.",
      });
    }
    if (source.usage_role === "analytical" && source.data_kind === "rendered_imagery") {
      context.addIssue({ code: "custom", message: "Rendered imagery cannot be analytical data." });
    }
    if (source.usage_role !== "analytical" && source.eligible_for_analysis) {
      context.addIssue({
        code: "custom",
        message: "Only analytical sources can be eligible for analysis.",
      });
    }
    if (source.usage_role !== "analytical" && source.distribution.public_export !== "prohibited") {
      context.addIssue({
        code: "custom",
        message: "Reference or review sources cannot enter public analytical export.",
      });
    }
    if (
      source.qualification !== "qualified_free" &&
      source.distribution.public_export !== "prohibited"
    ) {
      context.addIssue({
        code: "custom",
        message: "Unqualified sources cannot enter public export.",
      });
    }
    if (source.distribution.public_export === "allowed" && source.not_authoritative) {
      context.addIssue({
        code: "custom",
        message: "Non-authoritative sources cannot enter public analytical export.",
      });
    }
    if (
      source.usage_role === "analytical" &&
      source.data_kind === "vector" &&
      source.qualification === "qualified_free" &&
      !source.cache_provenance
    ) {
      context.addIssue({
        code: "custom",
        message: "Analytical vector sources require cache provenance.",
      });
    }
  });

export const sourceRegistryV2Schema = z
  .object({
    registry_version: z.literal("source_registry/v2"),
    sources: z.array(sourceRegistryV2EntrySchema).min(1),
  })
  .strict()
  .superRefine((registry, context) => {
    const sourceIds = registry.sources.map((source) => source.id);
    if (new Set(sourceIds).size !== sourceIds.length) {
      context.addIssue({ code: "custom", message: "Source registry IDs must be unique." });
    }
    for (const requiredId of [
      "openstreetmap",
      "prg_wfs",
      "bdot10k",
      "kiut_gesut_wms",
      "geoportal_orthophoto",
      "nmt_nmpt",
    ]) {
      if (!sourceIds.includes(requiredId)) {
        context.addIssue({
          code: "custom",
          message: `Source registry v2 is missing required source family: ${requiredId}.`,
        });
      }
    }
  });

export function isPublicExportEligible(
  source: z.infer<typeof sourceRegistryV2EntrySchema>,
): boolean {
  return (
    source.distribution.public_export === "allowed" &&
    source.qualification === "qualified_free" &&
    source.usage_role === "analytical" &&
    source.data_kind !== "rendered_imagery"
  );
}

export function validateOrderedSourceProvenance(
  provenance: z.infer<typeof sourceProvenanceSchema>[],
  registry: z.infer<typeof sourceRegistryV2Schema>,
  publicExport: boolean,
): void {
  if (provenance.length === 0) {
    throw new Error("Ordered provenance must contain at least one source.");
  }
  const sourceIds = new Set<string>();
  for (const record of provenance) {
    const parsed = sourceProvenanceSchema.parse(record);
    if (sourceIds.has(parsed.source_id)) {
      throw new Error("Ordered provenance source IDs must be unique.");
    }
    const source = registry.sources.find((candidate) => candidate.id === parsed.source_id);
    if (!source) {
      throw new Error(`Unknown source registry ID: ${parsed.source_id}.`);
    }
    if (publicExport && !isPublicExportEligible(source)) {
      throw new Error(`Source ${parsed.source_id} is not eligible for public export.`);
    }
    sourceIds.add(parsed.source_id);
  }
}

export const sourceAvailabilityEntrySchema = z
  .object({
    source_id: z.string().min(1),
    availability: z.enum(["available", "unavailable", "not_eligible", "reference_only"]),
    aoi_coverage: z.enum(["covered", "uncovered", "not_applicable"]),
    feature_state: z.enum(["available", "empty", "not_applicable"]),
    evidence_timestamp: z.string().datetime(),
    fresh_after_days: z.number().int().positive(),
    evidence: z.string().min(1),
    freshness: z.enum(["fresh", "stale"]),
    eligibility: z.enum(["allowed", "rejected", "not_comparable"]),
    actionable_gap: z.boolean(),
  })
  .strict();

export const sourceAvailabilityReportSchema = z
  .object({
    report_version: z.literal("provider_source_availability/v1"),
    aoi_id: providerIdentifierSchema,
    evidence_timestamp: z.string().datetime(),
    sources: z.array(sourceAvailabilityEntrySchema).min(1),
  })
  .strict();

export const sourceListResponseSchema = z.object({
  aoi_id: providerIdentifierSchema,
  registry_version: z.literal("source_registry/v1"),
  sources: z.array(sourceRegistryV1EntrySchema),
});

export type SourceRegistry = z.infer<typeof sourceRegistrySchema>;
export type SourceRegistryV2 = z.infer<typeof sourceRegistryV2Schema>;
