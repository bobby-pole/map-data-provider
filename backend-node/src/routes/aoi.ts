import { Router, type Response } from "express";

import {
  ProviderDataError,
  getCachedLayer,
  getCachedLayers,
  getCachedReadiness,
  getDomainPack,
  getDomainPacks,
  getMapPresentation,
  getMapPresentationArchiveRange,
  getMapFeatureDetail,
  getMapPresentations,
  getSourcesForAoi,
  getSourceAvailability,
  type ProviderDataPaths,
} from "../services/providerDataService.js";
import { requestAoi } from "../services/aoiRequestService.js";
import { getReviewedIssues, updateIssueReview, type IssueStorePaths } from "../services/issueReviewService.js";
import {
  layerListResponseSchema,
  providerErrorSchema,
  readinessListResponseSchema,
  sourceListResponseSchema,
  aoiRequestResponseSchema,
  aoiRequestSchema,
  domainPackListResponseSchema,
  domainPackReadResponseSchema,
  issueListResponseSchema,
  issueReviewUpdateSchema,
  sourceAvailabilityReportSchema,
  mapPresentationListResponseSchema,
  mapPresentationResponseSchema,
  mapFeatureDetailResponseSchema,
} from "../types/provider.js";

export function createAoiRouter(options?: { issueStorePaths?: IssueStorePaths; providerDataPaths?: ProviderDataPaths }) {
  const aoiRouter = Router();

aoiRouter.get("/:aoiId/presentations", async (request, response) => {
  try {
    response.status(200).json(mapPresentationListResponseSchema.parse({
      response_version: "provider_map_presentation_list/v1",
      aoi_id: request.params.aoiId,
      presentations: await getMapPresentations(request.params.aoiId, options?.providerDataPaths),
    }));
  } catch (error) {
    respondWithProviderError(response, error);
  }
});

aoiRouter.get("/:aoiId/presentations/:domain", async (request, response) => {
  try {
    response.status(200).json(mapPresentationResponseSchema.parse(await getMapPresentation(
      request.params.aoiId,
      request.params.domain,
      options?.providerDataPaths,
    )));
  } catch (error) {
    respondWithProviderError(response, error);
  }
});

aoiRouter.get("/:aoiId/presentations/:domain/features/:sourceId", async (request, response) => {
  try {
    response.status(200).json(mapFeatureDetailResponseSchema.parse(await getMapFeatureDetail(
      request.params.aoiId,
      request.params.domain,
      request.params.sourceId,
      options?.providerDataPaths,
    )));
  } catch (error) {
    respondWithProviderError(response, error);
  }
});

aoiRouter.get("/:aoiId/presentations/:domain/archive", async (request, response) => {
  try {
    const archive = await getMapPresentationArchiveRange(
      request.params.aoiId,
      request.params.domain,
      request.header("range"),
      options?.providerDataPaths,
    );
    response.status(206)
      .set({
        "accept-ranges": "bytes",
        "content-range": `bytes ${archive.start}-${archive.end}/${archive.totalSize}`,
        "content-length": String(archive.bytes.length),
        "content-type": "application/vnd.pmtiles",
        etag: archive.etag,
        "cache-control": "public, max-age=0, must-revalidate",
      })
      .send(archive.bytes);
  } catch (error) {
    if (error instanceof ProviderDataError && error.kind === "invalid_request" && error.message.includes("range")) {
      response.status(416).set("content-range", "bytes */0").json(providerErrorSchema.parse({ error: error.kind, message: error.message }));
      return;
    }
    respondWithProviderError(response, error);
  }
});

aoiRouter.get("/:aoiId/domain-packs", async (request, response) => {
  try {
    response.status(200).json(domainPackListResponseSchema.parse({
      response_version: "provider_domain_pack_list/v2",
      aoi_id: request.params.aoiId,
      domain_packs: await getDomainPacks(request.params.aoiId, options?.providerDataPaths),
    }));
  } catch (error) {
    respondWithProviderError(response, error);
  }
});

aoiRouter.get("/:aoiId/domain-packs/:domain", async (request, response) => {
  try {
    response.status(200).json(domainPackReadResponseSchema.parse(await getDomainPack(
      request.params.aoiId,
      request.params.domain,
      options?.providerDataPaths,
    )));
  } catch (error) {
    respondWithProviderError(response, error);
  }
});

aoiRouter.post("/requests", async (request, response) => {
  try {
    const body = aoiRequestSchema.parse(request.body);
    response.status(200).json(aoiRequestResponseSchema.parse(await requestAoi(body.aoi_id, body.domain)));
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      respondWithProviderError(response, new ProviderDataError("invalid_request", "Malformed AOI request."));
      return;
    }
    respondWithProviderError(response, error);
  }
});

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

aoiRouter.get("/:aoiId/source-availability", async (request, response) => {
  try {
    response.status(200).json(sourceAvailabilityReportSchema.parse(await getSourceAvailability(request.params.aoiId, options?.providerDataPaths)));
  } catch (error) {
    respondWithProviderError(response, error);
  }
});

aoiRouter.get("/:aoiId/issues", async (request, response) => {
  try {
    response.status(200).json(issueListResponseSchema.parse({
      aoi_id: request.params.aoiId,
      issues: await getReviewedIssues(request.params.aoiId, options?.issueStorePaths),
    }));
  } catch (error) {
    respondWithProviderError(response, error);
  }
});

aoiRouter.patch("/:aoiId/issues/:issueId/review", async (request, response) => {
  try {
    const update = issueReviewUpdateSchema.parse(request.body);
    response.status(200).json(await updateIssueReview(request.params.aoiId, request.params.issueId, update, options?.issueStorePaths));
  } catch (error) {
    if (error instanceof Error && error.name === "ZodError") {
      respondWithProviderError(response, new ProviderDataError("invalid_request", "Malformed issue review update."));
      return;
    }
    respondWithProviderError(response, error);
  }
});

  return aoiRouter;
}

function respondWithProviderError(response: Response, error: unknown): void {
  if (error instanceof ProviderDataError) {
    response.status(error.kind === "invalid_request" ? 422 : error.kind === "not_found" ? 404 : error.kind === "conflict" ? 409 : 502).json(
      providerErrorSchema.parse({
        error: error.kind,
        message: error.message,
      }),
    );
    return;
  }
  throw error;
}
