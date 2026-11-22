import type { Router } from "express";

import {
  getMapCircuitDetail,
  getMapCircuitsForFeature,
  getMapFeatureDetail,
  getMapPresentation,
  getMapPresentationArchiveInfo,
  getMapPresentationArchiveRange,
  getMapPresentations,
  ProviderDataError,
} from "../../services/providerDataService.js";
import {
  mapCircuitDetailResponseSchema,
  mapCircuitListResponseSchema,
  mapFeatureDetailResponseSchema,
  mapPresentationListResponseSchema,
  mapPresentationResponseSchema,
  providerErrorSchema,
} from "../../types/provider.js";
import { type AoiRouterContext, matchesIfNoneMatch, respondWithProviderError } from "./shared.js";

export function registerPresentationRoutes(aoiRouter: Router, ctx: AoiRouterContext): void {
  const { options } = ctx;

  aoiRouter.get("/:aoiId/presentations", async (request, response) => {
    try {
      response.status(200).json(
        mapPresentationListResponseSchema.parse({
          response_version: "provider_map_presentation_list/v1",
          aoi_id: request.params.aoiId,
          presentations: await getMapPresentations(
            request.params.aoiId,
            options?.providerDataPaths,
          ),
        }),
      );
    } catch (error) {
      respondWithProviderError(response, error);
    }
  });

  aoiRouter.get("/:aoiId/presentations/:domain", async (request, response) => {
    try {
      response
        .status(200)
        .json(
          mapPresentationResponseSchema.parse(
            await getMapPresentation(
              request.params.aoiId,
              request.params.domain,
              options?.providerDataPaths,
            ),
          ),
        );
    } catch (error) {
      respondWithProviderError(response, error);
    }
  });

  aoiRouter.get("/:aoiId/presentations/:domain/features/:sourceId", async (request, response) => {
    try {
      response
        .status(200)
        .json(
          mapFeatureDetailResponseSchema.parse(
            await getMapFeatureDetail(
              request.params.aoiId,
              request.params.domain,
              request.params.sourceId,
              options?.providerDataPaths,
            ),
          ),
        );
    } catch (error) {
      respondWithProviderError(response, error);
    }
  });

  aoiRouter.get(
    "/:aoiId/presentations/:domain/features/:sourceId/circuits",
    async (request, response) => {
      try {
        response
          .status(200)
          .json(
            mapCircuitListResponseSchema.parse(
              await getMapCircuitsForFeature(
                request.params.aoiId,
                request.params.domain,
                request.params.sourceId,
                options?.providerDataPaths,
              ),
            ),
          );
      } catch (error) {
        respondWithProviderError(response, error);
      }
    },
  );

  aoiRouter.get("/:aoiId/presentations/:domain/circuits/:circuitId", async (request, response) => {
    try {
      response
        .status(200)
        .json(
          mapCircuitDetailResponseSchema.parse(
            await getMapCircuitDetail(
              request.params.aoiId,
              request.params.domain,
              request.params.circuitId,
              options?.providerDataPaths,
            ),
          ),
        );
    } catch (error) {
      respondWithProviderError(response, error);
    }
  });

  aoiRouter.get("/:aoiId/presentations/:domain/archive", async (request, response) => {
    try {
      const archiveInfo = await getMapPresentationArchiveInfo(
        request.params.aoiId,
        request.params.domain,
        options?.providerDataPaths,
      );
      if (matchesIfNoneMatch(request.header("if-none-match"), archiveInfo.etag)) {
        response
          .status(304)
          .set({
            etag: archiveInfo.etag,
            "cache-control": "public, max-age=0, must-revalidate",
          })
          .end();
        return;
      }
      const archive = await getMapPresentationArchiveRange(
        request.params.aoiId,
        request.params.domain,
        request.header("range"),
        options?.providerDataPaths,
        archiveInfo,
      );
      response
        .status(206)
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
      if (
        error instanceof ProviderDataError &&
        error.kind === "invalid_request" &&
        error.message.includes("range")
      ) {
        response
          .status(416)
          .set("content-range", "bytes */0")
          .json(providerErrorSchema.parse({ error: error.kind, message: error.message }));
        return;
      }
      respondWithProviderError(response, error);
    }
  });
}
