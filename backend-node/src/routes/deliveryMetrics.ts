import { type Response, Router } from "express";

import {
  DeliveryMetricsError,
  type DeliveryMetricsPaths,
  getDeliveryMetrics,
  getDeliveryMetricsRaw,
} from "../services/deliveryMetricsService.js";

export function createDeliveryMetricsRouter(paths?: DeliveryMetricsPaths) {
  const router = Router();

  router.get("/delivery", async (_request, response) => {
    try {
      response.status(200).json(await getDeliveryMetrics(paths));
    } catch (error) {
      respond(response, error);
    }
  });

  router.get("/delivery/raw", async (_request, response) => {
    try {
      response
        .status(200)
        .set({ "cache-control": "no-cache", "content-type": "application/json; charset=utf-8" })
        .send(JSON.stringify(await getDeliveryMetricsRaw(paths), null, 2));
    } catch (error) {
      respond(response, error);
    }
  });

  return router;
}

function respond(response: Response, error: unknown): void {
  if (error instanceof DeliveryMetricsError) {
    response.status(error.kind === "not_found" ? 404 : 422).json({
      error: error.kind === "not_found" ? "not_found" : "invalid_request",
      message: error.message,
    });
    return;
  }
  response
    .status(502)
    .json({ error: "worker_failed", message: "Unable to read delivery metrics." });
}
