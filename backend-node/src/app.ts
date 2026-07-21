import express from "express";

import { aoiRouter } from "./routes/aoi.js";
import { healthRouter } from "./routes/health.js";

export function createApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", healthRouter);
  app.use("/api/aoi", aoiRouter);
  return app;
}
