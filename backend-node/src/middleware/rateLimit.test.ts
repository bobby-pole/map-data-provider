import request from "supertest";
import { describe, expect, it } from "vitest";

import { createApp } from "../app.js";

describe("Rate limiting and concurrency protection", () => {
  it("enforces rate limits when threshold is exceeded", async () => {
    const app = createApp({
      rateLimitOptions: {
        windowMs: 60_000,
        maxRequests: 3,
        maxConcurrent: 10,
      },
    });

    const res1 = await request(app).get("/api/health");
    expect(res1.status).toBe(200);
    const res2 = await request(app).get("/api/health");
    expect(res2.status).toBe(200);
    const res3 = await request(app).get("/api/health");
    expect(res3.status).toBe(200);

    const res4 = await request(app).get("/api/health");
    expect(res4.status).toBe(429);
    expect(res4.body).toEqual({
      error: "rate_limit_exceeded",
      message: "Rate limit exceeded. Please retry later.",
    });
  });

  it("does not let PMTiles byte-range delivery exhaust the API request budget", async () => {
    const app = createApp({
      rateLimitOptions: {
        windowMs: 60_000,
        maxRequests: 1,
        maxConcurrent: 10,
      },
    });

    await request(app).get("/api/aoi/not-present/presentations/power/archive");
    await request(app).get("/api/aoi/not-present/presentations/power/archive");

    expect((await request(app).get("/api/health")).status).toBe(200);
    expect((await request(app).get("/api/health")).status).toBe(429);
  });

  it("uses forwarded client addresses behind the trusted reverse proxy", async () => {
    const app = createApp({
      rateLimitOptions: {
        windowMs: 60_000,
        maxRequests: 1,
        maxConcurrent: 10,
      },
    });

    expect(
      (await request(app).get("/api/health").set("x-forwarded-for", "198.51.100.10")).status,
    ).toBe(200);
    expect(
      (await request(app).get("/api/health").set("x-forwarded-for", "198.51.100.11")).status,
    ).toBe(200);
  });
});
