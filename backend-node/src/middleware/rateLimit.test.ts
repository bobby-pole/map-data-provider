import { EventEmitter } from "node:events";

import type { Request, Response } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createApp } from "../app.js";
import { createRateLimiter } from "./rateLimit.js";

describe("Rate limiting and concurrency protection", () => {
  it("releases aborted responses and counts finish followed by close only once", () => {
    const limiter = createRateLimiter({ maxConcurrent: 2 });
    const req = { ip: "198.51.100.10" } as Request;
    const enter = () => {
      const res = Object.assign(new EventEmitter(), {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
      });
      const next = vi.fn();
      limiter(req, res as unknown as Response, next);
      return { res, next };
    };

    const aborted = enter();
    const ongoing = enter();
    expect(aborted.next).toHaveBeenCalledOnce();
    expect(ongoing.next).toHaveBeenCalledOnce();
    expect(enter().res.status).toHaveBeenCalledWith(503);

    // A disconnected client never emits finish.
    aborted.res.emit("close");
    const replacement = enter();
    expect(replacement.next).toHaveBeenCalledOnce();
    expect(enter().res.status).toHaveBeenCalledWith(503);

    replacement.res.emit("finish");
    replacement.res.emit("close");
    const afterFinish = enter();
    expect(afterFinish.next).toHaveBeenCalledOnce();
    // The earlier request is still active: no second slot may be released.
    expect(enter().res.status).toHaveBeenCalledWith(503);
    ongoing.res.emit("finish");
    afterFinish.res.emit("close");
    expect(enter().next).toHaveBeenCalledOnce();
  });

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
    expect(res4.headers["retry-after"]).toMatch(/^\d+$/);
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
