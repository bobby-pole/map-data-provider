import type { NextFunction, Request, Response } from "express";

import type {
  getRuntimeJob,
  submitDemoRuntimeJob,
  submitRuntimeJob,
} from "../../services/aoiRuntimeService.js";
import type { IssueStorePaths } from "../../services/issueReviewService.js";
import { getPreparedSnapshot } from "../../services/preparedSnapshotService.js";
import { ProviderDataError, type ProviderDataPaths } from "../../services/providerDataService.js";
import type { RuntimeAcquisitionPolicy } from "../../services/runtimeAcquisitionPolicy.js";
import { providerErrorSchema } from "../../types/provider.js";

export type AoiRouterOptions = {
  issueStorePaths?: IssueStorePaths;
  providerDataPaths?: ProviderDataPaths;
  runtimePolicy?: RuntimeAcquisitionPolicy;
  runtimeJobSubmitter?: typeof submitRuntimeJob;
  demoRuntimeJobSubmitter?: typeof submitDemoRuntimeJob;
  runtimeJobGetter?: typeof getRuntimeJob;
};

export type AoiRouterContext = {
  options: AoiRouterOptions | undefined;
  runtimePolicy: RuntimeAcquisitionPolicy;
  runtimeJobSubmitter: typeof submitRuntimeJob;
  demoRuntimeJobSubmitter: typeof submitDemoRuntimeJob;
  runtimeJobGetter: typeof getRuntimeJob;
};

/**
 * Data readers are deliberately snapshot-gated. A pack left beside a failed
 * refresh is not a publication and must not become visible simply because a
 * caller knows its AOI path. A checksum-validated partial publication is
 * readable so its completed domain packs can remain useful while failed
 * outcomes stay explicit in the snapshot manifest. Source-availability and
 * issue-review records are metadata workflows, not prepared spatial
 * artefacts, so they remain available for a not-yet-published AOI. The
 * legacy POST /requests route has no AOI path and is also outside this
 * read-only guard.
 */
export function createPreparedSnapshotGuard(options?: AoiRouterOptions) {
  return async (request: Request, response: Response, next: NextFunction) => {
    const aoiId = request.params.aoiId;
    if (
      typeof aoiId !== "string" ||
      aoiId === "requests" ||
      /\/(?:sources|source-availability|issues)(?:\/|$)/.test(request.path)
    ) {
      next();
      return;
    }
    try {
      const snapshot = await getPreparedSnapshot(aoiId, options?.providerDataPaths);
      if (snapshot.state !== "ready" && snapshot.state !== "partial") {
        throw new ProviderDataError(
          "conflict",
          `Snapshot '${snapshot.snapshot_id}' is ${snapshot.state}; map data is not published yet.`,
        );
      }
      response.locals.preparedSnapshot = snapshot;
      next();
    } catch (error) {
      respondWithProviderError(response, error);
    }
  };
}

export function matchesIfNoneMatch(headerValue: string | undefined, etag: string): boolean {
  if (!headerValue) {
    return false;
  }
  return headerValue
    .split(",")
    .map((value) => value.trim())
    .some((value) => value === "*" || value === etag);
}

export function respondWithProviderError(response: Response, error: unknown): void {
  if (
    error instanceof Error &&
    (error.name === "ZodError" || error.constructor.name === "ZodError" || "issues" in error)
  ) {
    response.status(422).json(
      providerErrorSchema.parse({
        error: "invalid_request",
        message: "Malformed request payload.",
      }),
    );
    return;
  }
  if (
    error instanceof ProviderDataError ||
    (typeof error === "object" &&
      error !== null &&
      "kind" in error &&
      typeof (error as { kind: string }).kind === "string")
  ) {
    const providerError = error as ProviderDataError;
    response
      .status(
        providerError.kind === "invalid_request"
          ? 422
          : providerError.kind === "not_found"
            ? 404
            : providerError.kind === "conflict"
              ? 409
              : providerError.kind === "runtime_disabled"
                ? 403
                : providerError.kind === "demo_aoi_restricted"
                  ? 403
                  : providerError.kind === "runtime_unauthorized"
                    ? 401
                    : 502,
      )
      .json(
        providerErrorSchema.parse({
          error: providerError.kind,
          message: providerError.message,
        }),
      );
    return;
  }
  throw error;
}
