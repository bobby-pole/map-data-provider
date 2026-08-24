import type { HealthResponse } from "../types/health.js";

export function getHealth(): HealthResponse {
  return {
    status: "ok",
    service: "map-data-provider",
    version: "0.1.0",
  };
}
