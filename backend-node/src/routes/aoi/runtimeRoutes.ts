import type { Router } from "express";

import { requestAoi } from "../../services/aoiRequestService.js";
import {
  getAdministrativeBoundary,
  getAdministrativeCatalog,
  getRuntimeJobForAoi,
  preflightRuntimeRequest,
  submitRuntimeRequest,
} from "../../services/aoiRuntimeService.js";
import {
  availabilityForResolvedAoi,
  listPreparedSnapshots,
} from "../../services/preparedSnapshotService.js";
import { ProviderDataError } from "../../services/providerDataService.js";
import {
  DEMO_AOI_TEMPLATE,
  DEMO_AOI_TEMPLATE_ID,
  hasTrustedRuntimeAuthorization,
} from "../../services/runtimeAcquisitionPolicy.js";
import {
  administrativeBoundaryRequestSchema,
  administrativeBoundaryResponseSchema,
  administrativeCatalogResponseSchema,
  aoiAvailabilityRequestSchema,
  aoiAvailabilityResponseSchema,
  aoiRequestResponseSchema,
  aoiRequestSchema,
  preparedSnapshotCatalogueResponseSchema,
  providerRuntimeJobSchema,
  providerRuntimePreflightResponseSchema,
  type ProviderRuntimeRequest,
  providerRuntimeRequestSchema,
  providerRuntimeResponseSchema,
  runtimeCapabilityResponseSchema,
} from "../../types/provider.js";
import { type AoiRouterContext, respondWithProviderError } from "./shared.js";

export function registerRuntimeRoutes(aoiRouter: Router, ctx: AoiRouterContext): void {
  const { options, runtimePolicy, runtimeJobSubmitter, demoRuntimeJobSubmitter, runtimeJobGetter } =
    ctx;

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
      const activeJob = getRuntimeJobForAoi(requested.aoi);
      if (activeJob && (activeJob.state === "queued" || activeJob.state === "running")) {
        response.status(200).json(
          aoiAvailabilityResponseSchema.parse({
            response_version: "provider_aoi_availability/v1",
            requested_aoi_id: preflight.aoi.aoi_id,
            state: activeJob.state,
            snapshot_ids: [],
            explanation: `A permitted acquisition job is ${activeJob.state}; only completed domains will be published.`,
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
}
