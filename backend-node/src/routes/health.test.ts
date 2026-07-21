import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import { healthResponseSchema } from "../types/health.js";

describe("GET /api/health", () => {
  it("returns the typed provider health response", async () => {
    const response = await request(createApp()).get("/api/health");

    expect(response.status).toBe(200);
    expect(healthResponseSchema.parse(response.body)).toEqual({
      status: "ok",
      service: "map-data-quality-provider",
      version: "0.1.0",
    });
  });

  it("does not claim unimplemented provider endpoints", async () => {
    const response = await request(createApp()).get("/api/aoi/rybnik_60km/layers/power");

    expect(response.status).toBe(404);
  });
});
