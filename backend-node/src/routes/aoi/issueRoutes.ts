import type { Router } from "express";

import { getReviewedIssues, updateIssueReview } from "../../services/issueReviewService.js";
import { ProviderDataError } from "../../services/providerDataService.js";
import { issueListResponseSchema, issueReviewUpdateSchema } from "../../types/provider.js";
import { type AoiRouterContext, respondWithProviderError } from "./shared.js";

export function registerIssueRoutes(aoiRouter: Router, ctx: AoiRouterContext): void {
  const { options } = ctx;

  aoiRouter.get("/:aoiId/issues", async (request, response) => {
    try {
      response.status(200).json(
        issueListResponseSchema.parse({
          aoi_id: request.params.aoiId,
          issues: await getReviewedIssues(request.params.aoiId, options?.issueStorePaths),
        }),
      );
    } catch (error) {
      respondWithProviderError(response, error);
    }
  });

  aoiRouter.patch("/:aoiId/issues/:issueId/review", async (request, response) => {
    try {
      const update = issueReviewUpdateSchema.parse(request.body);
      response
        .status(200)
        .json(
          await updateIssueReview(
            request.params.aoiId,
            request.params.issueId,
            update,
            options?.issueStorePaths,
          ),
        );
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        respondWithProviderError(
          response,
          new ProviderDataError("invalid_request", "Malformed issue review update."),
        );
        return;
      }
      respondWithProviderError(response, error);
    }
  });
}
