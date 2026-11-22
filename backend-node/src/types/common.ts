import { z } from "zod";

export const providerIdentifierSchema = z.string().regex(/^[a-z0-9_]+$/);
export const sourceTypeSchema = z.enum(["analytical_vector", "manual_seed", "reference_overlay"]);

export const aoiCircleInputSchema = z
  .object({
    type: z.literal("circle"),
    longitude: z.number().finite().min(-180).max(180),
    latitude: z.number().finite().min(-90).max(90),
    radius_m: z.number().finite().min(100).max(100_000),
  })
  .strict();

export const administrativeAoiReferenceInputSchema = z
  .object({
    type: z.literal("administrative_reference"),
    reference_id: z.string().min(1),
  })
  .strict();

export const aoiInputSchema = z.union([
  aoiCircleInputSchema,
  administrativeAoiReferenceInputSchema,
]);

const runtimePointRadiusAoiSchema = z
  .object({
    type: z.literal("point_radius"),
    longitude: z.number().finite(),
    latitude: z.number().finite(),
    radius_m: z.number().finite(),
  })
  .strict();

const runtimeAdministrativeAoiSchema = z
  .object({
    type: z.literal("administrative_selection"),
    unit_ids: z.array(providerIdentifierSchema).min(1),
  })
  .strict();

export const runtimeAoiInputSchema = z.union([
  runtimePointRadiusAoiSchema,
  runtimeAdministrativeAoiSchema,
]);

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
  error: z.enum([
    "invalid_request",
    "not_found",
    "conflict",
    "worker_failed",
    "runtime_disabled",
    "demo_aoi_restricted",
    "runtime_unauthorized",
  ]),
  message: z.string(),
});
