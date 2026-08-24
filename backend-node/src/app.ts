import fs from "node:fs";
import path from "node:path";

import express from "express";

import { createRateLimiter, type RateLimitOptions } from "./middleware/rateLimit.js";
import { createAoiRouter } from "./routes/aoi.js";
import { healthRouter } from "./routes/health.js";
import type { IssueStorePaths } from "./services/issueReviewService.js";
import type { ProviderDataPaths } from "./services/providerDataService.js";

export function createApp(options?: {
  issueStorePaths?: IssueStorePaths;
  providerDataPaths?: ProviderDataPaths;
  readOnlyMode?: boolean;
  staticDir?: string;
  rateLimitOptions?: RateLimitOptions;
}) {
  const app = express();
  app.use(express.json());
  app.use("/api", createRateLimiter(options?.rateLimitOptions));
  app.use("/api", healthRouter);
  app.use("/api/aoi", createAoiRouter(options));

  const staticDir = options?.staticDir ?? process.env.STATIC_DIR;
  if (staticDir && fs.existsSync(staticDir)) {
    app.use(express.static(staticDir));
    app.use((request, response, next) => {
      if (request.method === "GET" && !request.path.startsWith("/api/")) {
        return response.sendFile(path.join(staticDir, "index.html"));
      }
      next();
    });
  }

  return app;
}
