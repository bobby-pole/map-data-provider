import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("map-data-quality-provider"),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;
