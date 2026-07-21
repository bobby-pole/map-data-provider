import { Router, type Response } from "express";

import {
  ProviderDataError,
  getCachedLayer,
  getCachedLayers,
  getCachedReadiness,
  getSourcesForAoi,
} from "../services/providerDataService.js";
import {
  layerListResponseSchema,
  providerErrorSchema,
  readinessListResponseSchema,
  sourceListResponseSchema,
} from "../types/provider.js";

export const aoiRouter = Router();

aoiRouter.get("/:aoiId/layers", async (request, response) => {
  try {
    const layers = await getCachedLayers(request.params.aoiId);
    response.status(200).json(layerListResponseSchema.parse({ aoi_id: request.params.aoiId, layers }));
  } catch (error) {
    respondWithProviderError(response, error);
  }
});

aoiRouter.get("/:aoiId/layers/:domain", async (request, response) => {
  try {
    response.status(200).json(await getCachedLayer(request.params.aoiId, request.params.domain));
  } catch (error) {
    respondWithProviderError(response, error);
  }
});

aoiRouter.get("/:aoiId/readiness", async (request, response) => {
  try {
    const readiness = await getCachedReadiness(request.params.aoiId);
    response.status(200).json(readinessListResponseSchema.parse({ aoi_id: request.params.aoiId, readiness }));
  } catch (error) {
    respondWithProviderError(response, error);
  }
});

aoiRouter.get("/:aoiId/sources", async (request, response) => {
  try {
    const registry = await getSourcesForAoi(request.params.aoiId);
    response.status(200).json(
      sourceListResponseSchema.parse({
        aoi_id: request.params.aoiId,
        registry_version: registry.registry_version,
        sources: registry.sources,
      }),
    );
  } catch (error) {
    respondWithProviderError(response, error);
  }
});

function respondWithProviderError(response: Response, error: unknown): void {
  if (error instanceof ProviderDataError) {
    response.status(error.kind === "invalid_request" ? 422 : 404).json(
      providerErrorSchema.parse({
        error: error.kind,
        message: error.message,
      }),
    );
    return;
  }
  throw error;
}
