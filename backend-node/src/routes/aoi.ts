import { type Response, Router } from "express";

import { requestAoi } from "../services/aoiRequestService.js";
import {
  getAdministrativeBoundary,
  getAdministrativeCatalog,
  getRuntimeJob,
  preflightRuntimeRequest,
  submitRuntimeJob,
  submitRuntimeRequest,
} from "../services/aoiRuntimeService.js";
import {
  getReviewedIssues,
  type IssueStorePaths,
  updateIssueReview,
} from "../services/issueReviewService.js";
import {
  getCachedLayer,
  getCachedLayers,
  getCachedReadiness,
  getDomainPack,
  getDomainPacks,
  getMapCircuitDetail,
  getMapCircuitsForFeature,
  getMapFeatureDetail,
  getMapPresentation,
  getMapPresentationArchiveRange,
  getMapPresentations,
  getSourceAvailability,
  getSourcesForAoi,
  ProviderDataError,
  type ProviderDataPaths,
} from "../services/providerDataService.js";
import {
  administrativeBoundaryRequestSchema,
  administrativeBoundaryResponseSchema,
  administrativeCatalogResponseSchema,
  aoiRequestResponseSchema,
  aoiRequestSchema,
  domainPackListResponseSchema,
  type DomainPackReadResponse,
  domainPackReadResponseSchema,
  issueListResponseSchema,
  issueReviewUpdateSchema,
  layerListResponseSchema,
  mapCircuitDetailResponseSchema,
  mapCircuitListResponseSchema,
  mapFeatureDetailResponseSchema,
  mapPresentationListResponseSchema,
  mapPresentationResponseSchema,
  multiDomainExportResponseSchema,
  providerErrorSchema,
  providerRuntimeJobSchema,
  providerRuntimePreflightResponseSchema,
  providerRuntimeRequestSchema,
  providerRuntimeResponseSchema,
  readinessListResponseSchema,
  type ReviewedIssue,
  runtimeProfileSchema,
  sourceAvailabilityReportSchema,
  sourceListResponseSchema,
} from "../types/provider.js";

export function createAoiRouter(options?: {
  issueStorePaths?: IssueStorePaths;
  providerDataPaths?: ProviderDataPaths;
  readOnlyMode?: boolean;
}) {
  const aoiRouter = Router();
  const isReadOnly =
    options?.readOnlyMode ??
    (process.env.MDQ_DEMO_MODE === "readonly" ||
      process.env.MDQ_RUNTIME_ACQUISITION_ENABLED === "false");

  const assertRuntimeEnabled = () => {
    if (isReadOnly) {
      throw new ProviderDataError(
        "runtime_disabled",
        "Live acquisition and cache refresh are disabled in public demo mode.",
      );
    }
  };

  aoiRouter.get("/catalog", async (_request, response) => {
    try {
      response
        .status(200)
        .json(administrativeCatalogResponseSchema.parse(await getAdministrativeCatalog()));
    } catch (error) {
      respondWithProviderError(response, error);
    }
  });

  aoiRouter.post("/catalog/boundary", async (request, response) => {
    try {
      response
        .status(200)
        .json(
          administrativeBoundaryResponseSchema.parse(
            await getAdministrativeBoundary(
              administrativeBoundaryRequestSchema.parse(request.body),
            ),
          ),
        );
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        respondWithProviderError(
          response,
          new ProviderDataError("invalid_request", "Malformed administrative boundary request."),
        );
        return;
      }
      respondWithProviderError(response, error);
    }
  });

  aoiRouter.post("/runtime-requests/preflight", async (request, response) => {
    try {
      response
        .status(200)
        .json(
          providerRuntimePreflightResponseSchema.parse(
            await preflightRuntimeRequest(providerRuntimeRequestSchema.parse(request.body)),
          ),
        );
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        respondWithProviderError(
          response,
          new ProviderDataError("invalid_request", "Malformed AOI preflight request."),
        );
        return;
      }
      respondWithProviderError(response, error);
    }
  });

  aoiRouter.post("/runtime-requests", async (request, response) => {
    try {
      assertRuntimeEnabled();
      response
        .status(200)
        .json(
          providerRuntimeResponseSchema.parse(
            await submitRuntimeRequest(providerRuntimeRequestSchema.parse(request.body)),
          ),
        );
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        respondWithProviderError(
          response,
          new ProviderDataError("invalid_request", "Malformed AOI runtime request."),
        );
        return;
      }
      respondWithProviderError(response, error);
    }
  });

  aoiRouter.post("/runtime-jobs", (request, response) => {
    try {
      assertRuntimeEnabled();
      response
        .status(202)
        .json(
          providerRuntimeJobSchema.parse(
            submitRuntimeJob(providerRuntimeRequestSchema.parse(request.body)),
          ),
        );
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        respondWithProviderError(
          response,
          new ProviderDataError("invalid_request", "Malformed AOI runtime request."),
        );
        return;
      }
      respondWithProviderError(response, error);
    }
  });

  aoiRouter.get("/runtime-jobs/:jobId", (request, response) => {
    const job = getRuntimeJob(request.params.jobId);
    if (!job) {
      respondWithProviderError(
        response,
        new ProviderDataError("not_found", "AOI preparation job was not found."),
      );
      return;
    }
    response.status(200).json(providerRuntimeJobSchema.parse(job));
  });

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
      const archive = await getMapPresentationArchiveRange(
        request.params.aoiId,
        request.params.domain,
        request.header("range"),
        options?.providerDataPaths,
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

  aoiRouter.get("/:aoiId/domain-packs", async (request, response) => {
    try {
      response.status(200).json(
        domainPackListResponseSchema.parse({
          response_version: "provider_domain_pack_list/v2",
          aoi_id: request.params.aoiId,
          domain_packs: await getDomainPacks(request.params.aoiId, options?.providerDataPaths),
        }),
      );
    } catch (error) {
      respondWithProviderError(response, error);
    }
  });

  aoiRouter.get("/:aoiId/domain-packs/:domain", async (request, response) => {
    try {
      response
        .status(200)
        .json(
          domainPackReadResponseSchema.parse(
            await getDomainPack(
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

  aoiRouter.get("/:aoiId/export", async (request, response) => {
    try {
      const domainsQuery = request.query.domains;
      if (typeof domainsQuery !== "string" || domainsQuery.trim() === "") {
        throw new ProviderDataError(
          "invalid_request",
          "Malformed AOI export request. Missing or invalid domains parameter.",
        );
      }
      const rawSegments = domainsQuery.split(",").map((s) => s.trim());
      if (rawSegments.length === 0 || rawSegments.some((segment) => segment === "")) {
        throw new ProviderDataError(
          "invalid_request",
          "Malformed AOI export request. Empty domain segments are not allowed.",
        );
      }
      const allowedDomains = new Set(runtimeProfileSchema.options);
      if (
        rawSegments.some(
          (domain) => !allowedDomains.has(domain as (typeof runtimeProfileSchema.options)[number]),
        )
      ) {
        throw new ProviderDataError(
          "invalid_request",
          "Malformed AOI export request. Unallowed or invalid domain in parameter.",
        );
      }
      const requestedDomains = Array.from(new Set(rawSegments)) as Array<
        (typeof runtimeProfileSchema.options)[number]
      >;

      const domainOutcomes: Array<{
        domain: (typeof runtimeProfileSchema.options)[number];
        status: "ready" | "needs_source" | "failed";
        detail: string;
        has_domain_pack: boolean;
      }> = [];
      const exportPacks: DomainPackReadResponse[] = [];

      for (const domain of requestedDomains) {
        const typedDomain = domain;
        try {
          const pack = await getDomainPack(
            request.params.aoiId,
            typedDomain,
            options?.providerDataPaths,
          );
          exportPacks.push({
            ...pack,
            layers: pack.layers.filter((l) => l.artifact.public_export === true),
          });
          domainOutcomes.push({
            domain: typedDomain,
            status: "ready",
            detail: `Domain pack for '${typedDomain}' is available.`,
            has_domain_pack: true,
          });
        } catch {
          domainOutcomes.push({
            domain: typedDomain,
            status: "needs_source",
            detail: `Domain pack for '${typedDomain}' is not cached or unavailable.`,
            has_domain_pack: false,
          });
        }
      }

      let issues: ReviewedIssue[] = [];
      try {
        const allIssues = await getReviewedIssues(request.params.aoiId, options?.issueStorePaths);
        issues = allIssues.filter((issue) =>
          requestedDomains.includes(issue.domain as (typeof runtimeProfileSchema.options)[number]),
        );
      } catch (error) {
        if (error instanceof ProviderDataError && error.kind === "not_found") {
          issues = [];
        } else {
          throw error;
        }
      }

      response.status(200).json(
        multiDomainExportResponseSchema.parse({
          export_version: "provider_multi_domain_export/v2",
          aoi_id: request.params.aoiId,
          exported_at: new Date().toISOString(),
          domain_outcomes: domainOutcomes,
          domain_packs: exportPacks,
          issues,
        }),
      );
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        respondWithProviderError(
          response,
          new ProviderDataError("invalid_request", "Malformed export request."),
        );
        return;
      }
      respondWithProviderError(response, error);
    }
  });

  aoiRouter.post("/requests", async (request, response) => {
    try {
      assertRuntimeEnabled();
      const body = aoiRequestSchema.parse(request.body);
      response
        .status(200)
        .json(aoiRequestResponseSchema.parse(await requestAoi(body.aoi_id, body.domain)));
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        respondWithProviderError(
          response,
          new ProviderDataError("invalid_request", "Malformed AOI request."),
        );
        return;
      }
      respondWithProviderError(response, error);
    }
  });

  aoiRouter.get("/:aoiId/layers", async (request, response) => {
    try {
      const layers = await getCachedLayers(request.params.aoiId);
      response
        .status(200)
        .json(layerListResponseSchema.parse({ aoi_id: request.params.aoiId, layers }));
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
      response
        .status(200)
        .json(readinessListResponseSchema.parse({ aoi_id: request.params.aoiId, readiness }));
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
      response
        .status(200)
        .json(
          sourceAvailabilityReportSchema.parse(
            await getSourceAvailability(request.params.aoiId, options?.providerDataPaths),
          ),
        );
    } catch (error) {
      respondWithProviderError(response, error);
    }
  });

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

  return aoiRouter;
}

function respondWithProviderError(response: Response, error: unknown): void {
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
