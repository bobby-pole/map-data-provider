import { z } from "zod";

import { providerIdentifierSchema } from "./common.js";
import { sourceProvenanceSchema } from "./sources.js";

const measurementLatencySchema = z
  .object({
    p50: z.number().nonnegative(),
    p95: z.number().nonnegative(),
    p99: z.number().nonnegative(),
  })
  .passthrough();

const measurementResponseBytesSchema = z
  .object({
    mean: z.number().nonnegative(),
    total: z.number().nonnegative(),
  })
  .passthrough();

const deliveryMeasurementApiSchema = z
  .object({
    id: z.string().min(1),
    method: z.literal("GET"),
    path: z.string().startsWith("/api/"),
    sample_count: z.number().int().positive(),
    latency_ms: measurementLatencySchema,
    response_bytes: measurementResponseBytesSchema,
  })
  .passthrough();

const deliveryMeasurementWorkerSchema = z
  .object({
    fixture_mode: z.literal(true),
    fixture_preparation: z
      .object({
        duration_ms: z.number().nonnegative(),
        domains: z.number().int().nonnegative(),
        processed_feature_count: z.number().int().nonnegative(),
      })
      .passthrough(),
    worker: z
      .object({
        successes: z.number().int().nonnegative(),
        failures: z.number().int().nonnegative(),
        success_rate: z.number().min(0).max(1),
      })
      .strict(),
    runtime_cache: z
      .object({
        samples: z.number().int().positive(),
        hits: z.number().int().nonnegative(),
        misses: z.number().int().nonnegative(),
        hit_ratio: z.number().min(0).max(1),
      })
      .passthrough(),
    runtime_outcomes: z
      .object({
        ready: z.number().int().nonnegative(),
        needs_source: z.number().int().nonnegative(),
        failed: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .passthrough();

export const deliveryMeasurementReportSchema = z
  .object({
    measurement_version: z.literal("mdq_demo_delivery_measurement/v1"),
    measured_at: z.string().datetime(),
    git_revision: z.string().nullable(),
    bundle_id: z.string().min(1),
    bundle_manifest_sha256: z.string().regex(/^[a-f0-9]{64}$/),
    methodology: z
      .object({
        samples_per_endpoint: z.number().int().positive(),
        percentile: z.string().min(1),
        rate_limit_retries: z.number().int().nonnegative().optional(),
        service_mode: z.string().min(1),
        caveat: z.string().min(1),
      })
      .strict(),
    environment: z
      .object({
        base_url: z.string().url(),
        aoi_id: providerIdentifierSchema,
        node: z.string().min(1),
        platform: z.string().min(1),
        cpu_model: z.string().min(1),
      })
      .strict(),
    api: z.array(deliveryMeasurementApiSchema).min(1),
    pmtiles: z
      .object({
        path: z.string().startsWith("/api/"),
        range: z.string().min(1),
        revalidation_cache: z
          .object({
            hits: z.number().int().nonnegative(),
            misses: z.number().int().nonnegative(),
            hit_ratio: z.number().min(0).max(1),
            hit_definition: z.string().min(1),
          })
          .strict(),
        range_requests: z
          .object({
            response_bytes: measurementResponseBytesSchema,
          })
          .passthrough(),
      })
      .passthrough(),
    delivered_inventory: z
      .object({
        domains: z.number().int().nonnegative(),
        public_layers: z.number().int().nonnegative(),
        processed_feature_count: z.number().int().nonnegative(),
      })
      .passthrough(),
    fixture_worker: deliveryMeasurementWorkerSchema,
  })
  .strict();

export const deliveryMetricsResponseSchema = deliveryMeasurementReportSchema
  .omit({ bundle_manifest_sha256: true })
  .extend({
    response_version: z.literal("provider_delivery_metrics/v1"),
    raw_report_url: z.literal("/api/metrics/delivery/raw"),
  })
  .strict();

const presentationBoundsSchema = z
  .tuple([
    z.number().min(-180).max(180),
    z.number().min(-90).max(90),
    z.number().min(-180).max(180),
    z.number().min(-90).max(90),
  ])
  .refine(([minLon, minLat, maxLon, maxLat]) => minLon <= maxLon && minLat <= maxLat, {
    message: "Presentation bounds must not be inverted (a single point has zero extent).",
  });

export const mapPresentationLayerSchema = z
  .object({
    artifact_id: z.string().min(1),
    source_layer: z.string().regex(/^[a-z0-9_]+$/),
    feature_count: z.number().int().nonnegative(),
    source: z.string().min(1),
    confidence: z.enum(["high", "medium", "low", "not_applicable"]),
    readiness: z.enum(["ready", "usable_with_limitations", "needs_source", "not_usable"]),
    limitations: z.array(z.string()),
    attribution: z.string().min(1),
    attribution_html: z.string().min(1),
    source_provenance: z.array(sourceProvenanceSchema).min(1),
  })
  .strict();

export const mapPresentationManifestSchema = z
  .object({
    presentation_version: z.literal("provider_map_presentation/v1"),
    aoi_id: providerIdentifierSchema,
    domain: providerIdentifierSchema,
    parent_domain_pack: z
      .object({
        version: z.literal("provider_domain_pack/v2"),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
    archive: z
      .object({
        format: z.literal("pmtiles"),
        path: z.string().min(1),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        size_bytes: z.number().int().positive(),
        min_zoom: z.number().int().min(0).max(22),
        max_zoom: z.number().int().min(0).max(22),
        bounds: presentationBoundsSchema,
      })
      .strict()
      .refine((archive) => archive.min_zoom <= archive.max_zoom, {
        message: "Presentation zoom range is invalid.",
      }),
    layers: z.array(mapPresentationLayerSchema).min(1),
    attribution: z.string().min(1),
    benchmark: z
      .object({
        benchmark_version: z.literal("provider_map_presentation_benchmark/v1"),
        baseline: z
          .object({
            delivery: z.literal("full_geojson_to_leaflet"),
            feature_count: z.number().int().nonnegative(),
            payload_bytes: z.number().int().positive(),
          })
          .strict(),
        presentation: z
          .object({
            delivery: z.literal("pmtiles_mvt_range_reads"),
            archive_bytes: z.number().int().positive(),
            addressed_tiles: z.number().int().positive(),
            min_zoom: z.number().int(),
            max_zoom: z.number().int(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

export const mapPresentationResponseSchema = mapPresentationManifestSchema
  .extend({
    response_version: z.literal("provider_map_presentation_read/v1"),
    archive_url: z.string().startsWith("/api/aoi/"),
  })
  .strict();

export const mapPresentationListResponseSchema = z
  .object({
    response_version: z.literal("provider_map_presentation_list/v1"),
    aoi_id: providerIdentifierSchema,
    presentations: z.array(mapPresentationResponseSchema),
  })
  .strict();

export const mapFeatureDetailResponseSchema = z
  .object({
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
  })
  .strict();

const osmElementIdentifierSchema = z.string().regex(/^(node|way|relation)\/\d+$/);

const circuitMemberSchema = z
  .object({
    source_id: osmElementIdentifierSchema,
    role: z.string(),
    availability: z.string().optional(),
    endpoint_evidence: z
      .object({ start: osmElementIdentifierSchema, end: osmElementIdentifierSchema })
      .strict()
      .optional(),
    geometry: z
      .object({
        type: z.literal("LineString"),
        coordinates: z.array(z.tuple([z.number(), z.number()])).min(2),
      })
      .optional(),
  })
  .strict();

const powerCircuitSchema = z
  .object({
    relation_id: z.string().regex(/^relation\/\d+$/),
    tags: z.record(z.string(), z.string()),
    aoi_coverage: z.literal("bounded_source_snapshot"),
    limitations: z.array(z.string().min(1)).min(1),
    members: z.array(circuitMemberSchema).min(1),
  })
  .strict();

const powerCircuitSummarySchema = z
  .object({
    relation_id: z.string().regex(/^relation\/\d+$/),
    tags: z.record(z.string(), z.string()),
    aoi_coverage: z.literal("bounded_source_snapshot"),
    member_count: z.number().int().positive(),
  })
  .strict();

const availablePowerCircuitEvidencePayloadSchema = z
  .object({
    relation_evidence_version: z.literal("osm_power_relation_evidence/v2"),
    source: z.literal("OpenStreetMap"),
    snapshot_at: z.string().datetime(),
    bbox: z.array(z.number().finite()).length(4),
    source_checksum: z.string().regex(/^[a-f0-9]{64}$/),
    relations: z.array(powerCircuitSchema),
    reverse_member_index: z.record(z.string(), z.array(z.string().regex(/^relation\/\d+$/))),
  })
  .strict();

const unavailablePowerCircuitEvidencePayloadSchema = z
  .object({
    relation_evidence_version: z.literal("osm_power_relation_evidence/v2"),
    source: z.literal("OpenStreetMap"),
    snapshot_at: z.string().datetime(),
    bbox: z.array(z.number().finite()).length(4),
    source_checksum: z.null(),
    relations: z.array(powerCircuitSchema).length(0),
    reverse_member_index: z
      .record(z.string(), z.array(z.string().regex(/^relation\/\d+$/)))
      .refine((index) => Object.keys(index).length === 0),
    availability: z.literal("unavailable"),
    limitations: z.array(z.string().min(1)).min(1),
  })
  .strict();

export const powerCircuitEvidencePayloadSchema = z.union([
  availablePowerCircuitEvidencePayloadSchema,
  unavailablePowerCircuitEvidencePayloadSchema,
]);

export const mapCircuitListResponseSchema = z
  .object({
    response_version: z.literal("provider_map_circuit_list/v1"),
    aoi_id: providerIdentifierSchema,
    domain: providerIdentifierSchema,
    source_id: osmElementIdentifierSchema,
    state: z.enum(["available", "not_applicable", "unavailable"]),
    circuits: z.array(powerCircuitSummarySchema),
    limitations: z.array(z.string().min(1)).optional(),
  })
  .strict();

export const mapCircuitDetailResponseSchema = z
  .object({
    response_version: z.literal("provider_map_circuit_detail/v1"),
    aoi_id: providerIdentifierSchema,
    domain: providerIdentifierSchema,
    circuit: powerCircuitSchema,
  })
  .strict();

export type MapCircuitDetailResponse = z.infer<typeof mapCircuitDetailResponseSchema>;
export type MapCircuitListResponse = z.infer<typeof mapCircuitListResponseSchema>;
export type MapFeatureDetailResponse = z.infer<typeof mapFeatureDetailResponseSchema>;
export type MapPresentationManifest = z.infer<typeof mapPresentationManifestSchema>;
export type MapPresentationResponse = z.infer<typeof mapPresentationResponseSchema>;
