import type { NextFunction, Request, Response } from "express";

export interface RateLimitOptions {
  windowMs?: number;
  maxRequests?: number;
  maxConcurrent?: number;
  /**
   * Skips the request-count budget while retaining the concurrent-request
   * guard. This is for bounded, cacheable delivery routes such as PMTiles
   * byte ranges, which a map renderer may request many times for one view.
   */
  skipRequestCount?: (request: Request) => boolean;
}

export function createRateLimiter(options?: RateLimitOptions) {
  const windowMs = options?.windowMs ?? 60_000;
  const maxRequests = options?.maxRequests ?? 240;
  const maxConcurrent = options?.maxConcurrent ?? 50;

  const requestCounts = new Map<string, { count: number; resetAt: number }>();
  let activeRequests = 0;

  return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
    if (activeRequests >= maxConcurrent) {
      res.status(503).json({
        error: "service_unavailable",
        message: "Too many concurrent requests. Please retry shortly.",
      });
      return;
    }

    if (!options?.skipRequestCount?.(req)) {
      const ip = req.ip || req.socket.remoteAddress || "unknown";
      const now = Date.now();
      const entry = requestCounts.get(ip);

      if (!entry || now > entry.resetAt) {
        requestCounts.set(ip, { count: 1, resetAt: now + windowMs });
      } else {
        entry.count += 1;
        if (entry.count > maxRequests) {
          res.status(429).json({
            error: "rate_limit_exceeded",
            message: "Rate limit exceeded. Please retry later.",
          });
          return;
        }
      }
    }

    activeRequests += 1;
    res.on("finish", () => {
      activeRequests = Math.max(0, activeRequests - 1);
    });

    next();
  };
}
