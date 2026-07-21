import { Router } from "express";

import { getHealth } from "../services/healthService.js";
import { healthResponseSchema } from "../types/health.js";

export const healthRouter = Router();

healthRouter.get("/health", (_request, response) => {
  response.status(200).json(healthResponseSchema.parse(getHealth()));
});
