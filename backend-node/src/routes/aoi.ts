import { Router } from "express";

import {
  getRuntimeJob,
  submitDemoRuntimeJob,
  submitRuntimeJob,
} from "../services/aoiRuntimeService.js";
import { runtimePolicyFromEnvironment } from "../services/runtimeAcquisitionPolicy.js";
import { registerDataRoutes } from "./aoi/dataRoutes.js";
import { registerIssueRoutes } from "./aoi/issueRoutes.js";
import { registerPresentationRoutes } from "./aoi/presentationRoutes.js";
import { registerRuntimeRoutes } from "./aoi/runtimeRoutes.js";
import {
  type AoiRouterContext,
  type AoiRouterOptions,
  createPreparedSnapshotGuard,
} from "./aoi/shared.js";

export function createAoiRouter(options?: AoiRouterOptions) {
  const aoiRouter = Router();
  const ctx: AoiRouterContext = {
    options,
    runtimePolicy: options?.runtimePolicy ?? runtimePolicyFromEnvironment(),
    runtimeJobSubmitter: options?.runtimeJobSubmitter ?? submitRuntimeJob,
    demoRuntimeJobSubmitter: options?.demoRuntimeJobSubmitter ?? submitDemoRuntimeJob,
    runtimeJobGetter: options?.runtimeJobGetter ?? getRuntimeJob,
  };

  registerRuntimeRoutes(aoiRouter, ctx);
  aoiRouter.use("/:aoiId", createPreparedSnapshotGuard(options));
  registerPresentationRoutes(aoiRouter, ctx);
  registerDataRoutes(aoiRouter, ctx);
  registerIssueRoutes(aoiRouter, ctx);

  return aoiRouter;
}
