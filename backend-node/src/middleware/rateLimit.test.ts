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
});
