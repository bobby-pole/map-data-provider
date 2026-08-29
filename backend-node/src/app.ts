import fs from "node:fs";
import path from "node:path";

import express from "express";

import { createRateLimiter, type RateLimitOptions } from "./middleware/rateLimit.js";
import { createAoiRouter } from "./routes/aoi.js";
import { createDeliveryMetricsRouter } from "./routes/deliveryMetrics.js";
import { healthRouter } from "./routes/health.js";
import type { DeliveryMetricsPaths } from "./services/deliveryMetricsService.js";
import type { IssueStorePaths } from "./services/issueReviewService.js";
import type { ProviderDataPaths } from "./services/providerDataService.js";
import type { RuntimeAcquisitionPolicy } from "./services/runtimeAcquisitionPolicy.js";
import type { ProviderRuntimeJob, ProviderRuntimeRequest } from "./types/provider.js";

export function createApp(options?: {
  issueStorePaths?: IssueStorePaths;
  providerDataPaths?: ProviderDataPaths;
  deliveryMetricsPaths?: DeliveryMetricsPaths;
  runtimePolicy?: RuntimeAcquisitionPolicy;
  runtimeJobSubmitter?: (runtimeRequest: ProviderRuntimeRequest) => ProviderRuntimeJob;
  runtimeJobGetter?: (jobId: string) => ProviderRuntimeJob | undefined;
  staticDir?: string;
  rateLimitOptions?: RateLimitOptions;
}) {
  const app = express();
  // Production receives requests only through the local Nginx Proxy Manager
  // network. Trust those private proxy hops so rate limiting distinguishes
  // actual clients instead of treating every request as the proxy container.
  app.set("trust proxy", ["loopback", "linklocal", "uniquelocal"]);
  app.use(express.json());
  app.use(
    "/api",
    createRateLimiter({
      ...options?.rateLimitOptions,
      skipRequestCount: (request) =>
        options?.rateLimitOptions?.skipRequestCount?.(request) === true ||
        (request.method === "GET" &&
          /^\/api\/aoi\/[^/]+\/presentations\/[^/]+\/archive$/.test(
            request.originalUrl.split("?", 1)[0] ?? "",
          )),
    }),
  );
  app.use("/api", healthRouter);
  app.use("/api/metrics", createDeliveryMetricsRouter(options?.deliveryMetricsPaths));
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
