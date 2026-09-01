import { type Response, Router } from "express";

import { requestAoi } from "../services/aoiRequestService.js";
import {
  getAdministrativeBoundary,
  getAdministrativeCatalog,
  getRuntimeJob,
  getRuntimeJobForAoi,
  preflightRuntimeRequest,
  submitDemoRuntimeJob,
  submitRuntimeJob,
  submitRuntimeRequest,
} from "../services/aoiRuntimeService.js";
import {
  getReviewedIssues,
  type IssueStorePaths,
  updateIssueReview,
} from "../services/issueReviewService.js";
import {
  availabilityForResolvedAoi,
  getPreparedSnapshot,
  getRuntimeAcquisitionEvidence,
  listPreparedSnapshots,
} from "../services/preparedSnapshotService.js";
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
  getMapPresentationArchiveInfo,
  getMapPresentationArchiveRange,
  getMapPresentations,
  getSourceAvailability,
  getSourcesForAoi,
  ProviderDataError,
  type ProviderDataPaths,
} from "../services/providerDataService.js";
import {
  DEMO_AOI_TEMPLATE,
  DEMO_AOI_TEMPLATE_ID,
  hasTrustedRuntimeAuthorization,
  type RuntimeAcquisitionPolicy,
  runtimePolicyFromEnvironment,
} from "../services/runtimeAcquisitionPolicy.js";
import {
  administrativeBoundaryRequestSchema,
  administrativeBoundaryResponseSchema,
  administrativeCatalogResponseSchema,
  aoiAvailabilityRequestSchema,
  aoiAvailabilityResponseSchema,
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
  preparedSnapshotCatalogueResponseSchema,
  providerErrorSchema,
  providerRuntimeJobSchema,
  providerRuntimePreflightResponseSchema,
  type ProviderRuntimeRequest,
  providerRuntimeRequestSchema,
  providerRuntimeResponseSchema,
  readinessListResponseSchema,
  type ReviewedIssue,
  runtimeAcquisitionEvidenceSchema,
  runtimeCapabilityResponseSchema,
  runtimeProfileSchema,
  sourceAvailabilityReportSchema,
  sourceListResponseSchema,
} from "../types/provider.js";

export function createAoiRouter(options?: {
  issueStorePaths?: IssueStorePaths;
  providerDataPaths?: ProviderDataPaths;
  runtimePolicy?: RuntimeAcquisitionPolicy;
  runtimeJobSubmitter?: typeof submitRuntimeJob;
  demoRuntimeJobSubmitter?: typeof submitDemoRuntimeJob;
  runtimeJobGetter?: typeof getRuntimeJob;
}) {
  const aoiRouter = Router();
  const runtimePolicy = options?.runtimePolicy ?? runtimePolicyFromEnvironment();
  const runtimeJobSubmitter = options?.runtimeJobSubmitter ?? submitRuntimeJob;
  const demoRuntimeJobSubmitter = options?.demoRuntimeJobSubmitter ?? submitDemoRuntimeJob;
  const runtimeJobGetter = options?.runtimeJobGetter ?? getRuntimeJob;

  const assertDemoRuntimeRequest = async (runtimeRequest: unknown) => {
    const parsed = providerRuntimeRequestSchema.parse(runtimeRequest);
    const requestedProfiles = [...new Set(parsed.profiles)].sort();
    const allowedProfiles = new Set(DEMO_AOI_TEMPLATE.profiles);
    if (requestedProfiles.some((profile) => !allowedProfiles.has(profile))) {
      throw new ProviderDataError(
        "demo_aoi_restricted",
        "The public demo accepts only provider domains listed in its 11-domain capability template.",
      );
    }
    if (
      parsed.aoi.type === "point_radius" &&
      parsed.aoi.radius_m > DEMO_AOI_TEMPLATE.max_radius_m
    ) {
      throw new ProviderDataError(
        "demo_aoi_restricted",
        "The public demo allows a point radius of at most 10 km.",
      );
    }
    if (parsed.aoi.type === "administrative_selection") {
      const catalog = (await getAdministrativeCatalog()) as {
        units?: Array<{ id: string; kind: string; parent_id: string | null }>;
      };
      const byId = new Map((catalog.units ?? []).map((unit) => [unit.id, unit]));
      const counties = new Set<string>();
      for (const unitId of parsed.aoi.unit_ids) {
        let current = byId.get(unitId);
        const visited = new Set<string>();
        while (
          current &&
          current.kind !== "county" &&
          current.parent_id &&
          !visited.has(current.id)
        ) {
          visited.add(current.id);
          current = byId.get(current.parent_id);
        }
        if (current?.kind === "county") {
          counties.add(current.id);
        }
      }
      if (counties.size > DEMO_AOI_TEMPLATE.max_counties) {
        throw new ProviderDataError(
          "demo_aoi_restricted",
          "The public demo allows one PRG county at a time.",
        );
      }
    }
    return parsed;
  };

  const assertCustomRuntimeBounds = (runtimeRequest: ProviderRuntimeRequest) => {
    if (runtimeRequest.aoi.type === "point_radius" && runtimeRequest.aoi.radius_m > 30_000) {
      throw new ProviderDataError(
        "invalid_request",
        "Local and trusted runtime acquisition allows a point radius of at most 30 km.",
      );
    }
  };

  const assertGenericRuntimeAllowed = (authorizationHeader: string | undefined) => {
    if (runtimePolicy.mode === "disabled") {
      throw new ProviderDataError(
        "runtime_disabled",
        "Runtime acquisition is disabled in this deployment.",
      );
    }
    if (runtimePolicy.mode === "demo_fixed_aoi") {
      throw new ProviderDataError(
        "demo_aoi_restricted",
        "Public demo acquisition is limited to a Poland-contained 10 km point or one PRG county.",
      );
    }
    if (
      runtimePolicy.mode === "trusted" &&
      !hasTrustedRuntimeAuthorization(authorizationHeader, runtimePolicy.trustedToken)
    ) {
      throw new ProviderDataError(
        "runtime_unauthorized",
        "Trusted runtime acquisition requires an authenticated service identity.",
      );
    }
  };

  aoiRouter.get("/runtime-capabilities", (_request, response) => {
    const isDemo = runtimePolicy.mode === "demo_fixed_aoi";
    response.status(200).json(
      runtimeCapabilityResponseSchema.parse({
        response_version: "provider_runtime_capability/v1",
        mode: runtimePolicy.mode,
        supports_custom_aoi:
          runtimePolicy.mode === "demo_fixed_aoi" ||
          runtimePolicy.mode === "local_bounded" ||
          runtimePolicy.mode === "trusted",
        demo_template: isDemo
          ? {
              id: DEMO_AOI_TEMPLATE.id,
              label: DEMO_AOI_TEMPLATE.label,
              max_radius_m: DEMO_AOI_TEMPLATE.max_radius_m,
              max_counties: DEMO_AOI_TEMPLATE.max_counties,
              generates_pmtiles: DEMO_AOI_TEMPLATE.generates_pmtiles,
              profiles: DEMO_AOI_TEMPLATE.profiles,
            }
          : null,
      }),
    );
  });

  aoiRouter.get("/snapshots", async (_request, response) => {
    try {
      response.status(200).json(
        preparedSnapshotCatalogueResponseSchema.parse({
          response_version: "provider_prepared_snapshot_catalogue/v1",
          snapshots: await listPreparedSnapshots(options?.providerDataPaths),
        }),
      );
    } catch (error) {
      respondWithProviderError(response, error);
    }
  });

  aoiRouter.post("/availability", async (request, response) => {
    try {
      const requested = aoiAvailabilityRequestSchema.parse(request.body);
      const preflight = await preflightRuntimeRequest({ ...requested, profiles: ["power"] });
      const job = getRuntimeJobForAoi(requested.aoi);
      if (job && (job.state === "queued" || job.state === "running")) {
        response.status(200).json(
          aoiAvailabilityResponseSchema.parse({
            response_version: "provider_aoi_availability/v1",
            requested_aoi_id: preflight.aoi.aoi_id,
            state: job.state,
            snapshot_ids: [],
            explanation: `A permitted acquisition job is ${job.state}; only completed domains will be published.`,
            limitations: [],
          }),
        );
        return;
      }
      response
        .status(200)
        .json(
          aoiAvailabilityResponseSchema.parse(
            availabilityForResolvedAoi(
              { aoi_id: preflight.aoi.aoi_id, geometry: preflight.aoi.geometry },
              await listPreparedSnapshots(options?.providerDataPaths),
            ),
          ),
        );
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        respondWithProviderError(
          response,
          new ProviderDataError("invalid_request", "Malformed AOI availability request."),
        );
        return;
      }
      respondWithProviderError(response, error);
    }
  });

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
      const runtimeRequest = providerRuntimeRequestSchema.parse(request.body);
      if (runtimePolicy.mode === "demo_fixed_aoi") {
        await assertDemoRuntimeRequest(runtimeRequest);
      } else if (runtimePolicy.mode !== "disabled") {
        assertCustomRuntimeBounds(runtimeRequest);
      }
      response
        .status(200)
        .json(
          providerRuntimePreflightResponseSchema.parse(
            await preflightRuntimeRequest(runtimeRequest),
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
      if (runtimePolicy.mode === "demo_fixed_aoi") {
        assertGenericRuntimeAllowed(request.header("authorization"));
      }
      const runtimeRequest = providerRuntimeRequestSchema.parse(request.body);
      if (runtimePolicy.mode !== "disabled") {
        assertCustomRuntimeBounds(runtimeRequest);
      }
      assertGenericRuntimeAllowed(request.header("authorization"));
      response
        .status(200)
        .json(providerRuntimeResponseSchema.parse(await submitRuntimeRequest(runtimeRequest)));
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
      if (runtimePolicy.mode === "demo_fixed_aoi") {
        assertGenericRuntimeAllowed(request.header("authorization"));
      }
      const runtimeRequest = providerRuntimeRequestSchema.parse(request.body);
      if (runtimePolicy.mode !== "disabled") {
        assertCustomRuntimeBounds(runtimeRequest);
      }
      assertGenericRuntimeAllowed(request.header("authorization"));
      response
        .status(202)
        .json(providerRuntimeJobSchema.parse(runtimeJobSubmitter(runtimeRequest)));
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

  aoiRouter.post("/demo-acquisitions/:templateId", async (request, response) => {
    try {
      if (
        runtimePolicy.mode !== "demo_fixed_aoi" ||
        request.params.templateId !== DEMO_AOI_TEMPLATE_ID
      ) {
        throw new ProviderDataError(
          "demo_aoi_restricted",
          "This deployment exposes only the fixed Rybnik demo acquisition template.",
        );
      }
      const demoRequestBody = request.body as object | undefined;
      if (!demoRequestBody || Object.keys(demoRequestBody).length === 0) {
        throw new ProviderDataError(
          "demo_aoi_restricted",
          "The public demo requires a bounded point or one-county PRG AOI payload.",
        );
      }
      if (Object.prototype.hasOwnProperty.call(demoRequestBody, "force_refresh")) {
        throw new ProviderDataError(
          "demo_aoi_restricted",
          "The public demo does not allow force refresh.",
        );
      }
      const demoRequest = await assertDemoRuntimeRequest(demoRequestBody);
      await preflightRuntimeRequest(demoRequest);
      response
        .status(202)
        .json(providerRuntimeJobSchema.parse(demoRuntimeJobSubmitter(demoRequest)));
    } catch (error) {
      respondWithProviderError(response, error);
    }
  });

  aoiRouter.get("/runtime-jobs/:jobId", (request, response) => {
    const job = runtimeJobGetter(request.params.jobId);
    if (!job) {
      respondWithProviderError(
        response,
        new ProviderDataError("not_found", "AOI preparation job was not found."),
      );
      return;
    }
    response.status(200).json(providerRuntimeJobSchema.parse(job));
  });

  // Data readers are deliberately snapshot-gated. A pack left beside a failed
  // refresh is not a publication and must not become visible simply because a
  // caller knows its AOI path. A checksum-validated partial publication is
  // readable so its completed domain packs can remain useful while failed
  // outcomes stay explicit in the snapshot manifest. Source-availability and
  // issue-review records are metadata workflows, not prepared spatial
  // artefacts, so they remain available for a not-yet-published AOI. The
  // legacy POST /requests route below has no AOI path and is also outside this
  // read-only guard.
  aoiRouter.use("/:aoiId", async (request, response, next) => {
    if (
      request.params.aoiId === "requests" ||
      /\/(?:sources|source-availability|issues)(?:\/|$)/.test(request.path)
    ) {
      next();
      return;
    }
    try {
      const snapshot = await getPreparedSnapshot(request.params.aoiId, options?.providerDataPaths);
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

  aoiRouter.post("/requests", async (request, response) => {
    try {
      if (runtimePolicy.mode === "demo_fixed_aoi") {
        assertGenericRuntimeAllowed(request.header("authorization"));
      }
      const body = aoiRequestSchema.parse(request.body);
      assertGenericRuntimeAllowed(request.header("authorization"));
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

function matchesIfNoneMatch(headerValue: string | undefined, etag: string): boolean {
  if (!headerValue) {
    return false;
  }
  return headerValue
    .split(",")
    .map((value) => value.trim())
    .some((value) => value === "*" || value === etag);
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
