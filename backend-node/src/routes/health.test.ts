import path from "node:path";

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

  it("does not fabricate a cache for an unknown AOI", async () => {
    const response = await request(createApp()).get("/api/aoi/missing_aoi/layers/power");

    expect(response.status).toBe(404);
  });

  it("serves static SPA files when staticDir is configured", async () => {
    const app = createApp({ staticDir: path.resolve(import.meta.dirname, "../../../frontend") });
    const response = await request(app).get("/index.html");
    expect(response.status).toBe(200);

    const spaFallback = await request(app).get("/preview/custom-route");
    expect(spaFallback.status).toBe(200);
    expect(spaFallback.text).toContain("Map Data Quality Lab");
  });
});
