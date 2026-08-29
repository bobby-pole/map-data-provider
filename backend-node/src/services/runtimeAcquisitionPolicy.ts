import { timingSafeEqual } from "node:crypto";

import type { ProviderRuntimeRequest } from "../types/provider.js";

export type RuntimeAcquisitionMode = "disabled" | "demo_fixed_aoi" | "local_bounded" | "trusted";

export type RuntimeAcquisitionPolicy = {
  mode: RuntimeAcquisitionMode;
  trustedToken?: string;
};

export const DEMO_AOI_TEMPLATE_ID = "rybnik_gmina_demo";

export const DEMO_AOI_TEMPLATE = {
  id: DEMO_AOI_TEMPLATE_ID,
  label: "Rybnik administrative area",
  unit_ids: ["gmina_2473011"],
  profiles: ["power", "emergency", "public", "transport"],
  request: {
    aoi: { type: "administrative_selection", unit_ids: ["gmina_2473011"] },
    profiles: ["power", "emergency", "public", "transport"],
  },
} satisfies {
  id: string;
  label: string;
  unit_ids: string[];
  profiles: ProviderRuntimeRequest["profiles"];
  request: ProviderRuntimeRequest;
};

export class RuntimeAcquisitionConfigurationError extends Error {}

export function runtimePolicyFromEnvironment(
  environment: Record<string, string | undefined> = process.env,
): RuntimeAcquisitionPolicy {
  const mode = environment.MDQ_RUNTIME_MODE;
  if (!mode) {
    return { mode: "disabled" };
  }
  if (mode === "disabled" || mode === "local_bounded") {
    return { mode };
  }
  if (mode === "demo_fixed_aoi") {
    if (environment.MDQ_DEMO_AOI_TEMPLATE !== DEMO_AOI_TEMPLATE_ID) {
      throw new RuntimeAcquisitionConfigurationError(
        `MDQ_DEMO_AOI_TEMPLATE must be '${DEMO_AOI_TEMPLATE_ID}' when MDQ_RUNTIME_MODE=demo_fixed_aoi.`,
      );
    }
    return { mode };
  }
  if (mode === "trusted") {
    const trustedToken = environment.MDQ_TRUSTED_ACQUISITION_TOKEN;
    if (!trustedToken) {
      throw new RuntimeAcquisitionConfigurationError(
        "MDQ_TRUSTED_ACQUISITION_TOKEN is required when MDQ_RUNTIME_MODE=trusted.",
      );
    }
    return { mode, trustedToken };
  }
  throw new RuntimeAcquisitionConfigurationError(
    "MDQ_RUNTIME_MODE must be one of: disabled, demo_fixed_aoi, local_bounded, trusted.",
  );
}

export function hasTrustedRuntimeAuthorization(
  authorizationHeader: string | undefined,
  trustedToken: string | undefined,
): boolean {
  if (!authorizationHeader || !trustedToken || !authorizationHeader.startsWith("Bearer ")) {
    return false;
  }
  const supplied = Buffer.from(authorizationHeader.slice("Bearer ".length));
  const expected = Buffer.from(trustedToken);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
