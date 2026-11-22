import type { Router } from "express";

import { getReviewedIssues } from "../../services/issueReviewService.js";
import {
  getPreparedSnapshot,
  getRuntimeAcquisitionEvidence,
} from "../../services/preparedSnapshotService.js";
import {
  getCachedLayer,
  getCachedLayers,
  getCachedReadiness,
  getDomainPack,
  getDomainPacks,
  getSourceAvailability,
  getSourcesForAoi,
  ProviderDataError,
} from "../../services/providerDataService.js";
import {
  domainPackListResponseSchema,
  type DomainPackReadResponse,
  domainPackReadResponseSchema,
  layerListResponseSchema,
  multiDomainExportResponseSchema,
  readinessListResponseSchema,
  type ReviewedIssue,
  runtimeAcquisitionEvidenceSchema,
  runtimeProfileSchema,
  sourceAvailabilityReportSchema,
  sourceListResponseSchema,
} from "../../types/provider.js";
import { type AoiRouterContext, respondWithProviderError } from "./shared.js";

export function registerDataRoutes(aoiRouter: Router, ctx: AoiRouterContext): void {
  const { options } = ctx;

  aoiRouter.get("/:aoiId/metrics/acquisition", async (request, response) => {
    try {
      response
        .status(200)
        .json(
          runtimeAcquisitionEvidenceSchema.parse(
            await getRuntimeAcquisitionEvidence(request.params.aoiId, options?.providerDataPaths),
          ),
        );
    } catch (error) {
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
      const snapshot = await getPreparedSnapshot(request.params.aoiId, options?.providerDataPaths);
      if (snapshot.state !== "ready" && snapshot.state !== "partial") {
        throw new ProviderDataError(
          "conflict",
          `Snapshot '${snapshot.snapshot_id}' is ${snapshot.state} and cannot be exported.`,
        );
      }
      const snapshotDomains = new Map(
        snapshot.domain_outcomes.map((outcome) => [outcome.domain, outcome]),
      );

      const domainOutcomes: Array<{
        domain: (typeof runtimeProfileSchema.options)[number];
        status: "ready" | "needs_source" | "failed";
        detail: string;
        has_domain_pack: boolean;
      }> = [];
      const exportPacks: DomainPackReadResponse[] = [];

      for (const domain of requestedDomains) {
        const typedDomain = domain;
        const snapshotOutcome = snapshotDomains.get(typedDomain);
        if (!snapshotOutcome || snapshotOutcome.status !== "ready") {
          domainOutcomes.push({
            domain: typedDomain,
            status: snapshotOutcome?.status === "failed" ? "failed" : "needs_source",
            detail:
              snapshotOutcome?.detail ??
              `Snapshot '${snapshot.snapshot_id}' has no published '${typedDomain}' domain.`,
            has_domain_pack: false,
          });
          continue;
        }
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
          snapshot,
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

  aoiRouter.get("/:aoiId/layers", async (request, response) => {
    try {
      const layers = await getCachedLayers(request.params.aoiId, options?.providerDataPaths);
      response
        .status(200)
        .json(layerListResponseSchema.parse({ aoi_id: request.params.aoiId, layers }));
    } catch (error) {
      respondWithProviderError(response, error);
    }
  });

  aoiRouter.get("/:aoiId/layers/:domain", async (request, response) => {
    try {
      response
        .status(200)
        .json(
          await getCachedLayer(
            request.params.aoiId,
            request.params.domain,
            options?.providerDataPaths,
          ),
        );
    } catch (error) {
      respondWithProviderError(response, error);
    }
  });

  aoiRouter.get("/:aoiId/readiness", async (request, response) => {
    try {
      const readiness = await getCachedReadiness(request.params.aoiId, options?.providerDataPaths);
      response
        .status(200)
        .json(readinessListResponseSchema.parse({ aoi_id: request.params.aoiId, readiness }));
    } catch (error) {
      respondWithProviderError(response, error);
    }
  });

  aoiRouter.get("/:aoiId/sources", async (request, response) => {
    try {
      const registry = await getSourcesForAoi(request.params.aoiId, options?.providerDataPaths);
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
}
