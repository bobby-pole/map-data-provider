import express from "express";

import { createAoiRouter } from "./routes/aoi.js";
import { healthRouter } from "./routes/health.js";
import type { IssueStorePaths } from "./services/issueReviewService.js";
import type { ProviderDataPaths } from "./services/providerDataService.js";

export function createApp(options?: {
  issueStorePaths?: IssueStorePaths;
  providerDataPaths?: ProviderDataPaths;
}) {
  const app = express();
  app.use(express.json());
  app.use("/api", healthRouter);
  app.use("/api/aoi", createAoiRouter(options));
  return app;
}
