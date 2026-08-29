import { describe, expect, it } from "vitest";

import {
  DEMO_AOI_TEMPLATE_ID,
  hasTrustedRuntimeAuthorization,
  RuntimeAcquisitionConfigurationError,
  runtimePolicyFromEnvironment,
} from "./runtimeAcquisitionPolicy.js";

describe("runtime acquisition policy", () => {
  it("fails closed when no mode is configured", () => {
    expect(runtimePolicyFromEnvironment({})).toEqual({ mode: "disabled" });
  });

  it("requires the fixed template for the public demo", () => {
    expect(() => runtimePolicyFromEnvironment({ MDQ_RUNTIME_MODE: "demo_fixed_aoi" })).toThrow(
      RuntimeAcquisitionConfigurationError,
    );
    expect(
      runtimePolicyFromEnvironment({
        MDQ_RUNTIME_MODE: "demo_fixed_aoi",
        MDQ_DEMO_AOI_TEMPLATE: DEMO_AOI_TEMPLATE_ID,
      }),
    ).toEqual({ mode: "demo_fixed_aoi" });
  });

  it("rejects unrecognised modes and protects trusted acquisition with a bearer token", () => {
    expect(() => runtimePolicyFromEnvironment({ MDQ_RUNTIME_MODE: "everything" })).toThrow(
      RuntimeAcquisitionConfigurationError,
    );
    const trusted = runtimePolicyFromEnvironment({
      MDQ_RUNTIME_MODE: "trusted",
      MDQ_TRUSTED_ACQUISITION_TOKEN: "service-token",
    });
    expect(trusted).toEqual({ mode: "trusted", trustedToken: "service-token" });
    expect(hasTrustedRuntimeAuthorization("Bearer service-token", trusted.trustedToken)).toBe(true);
    expect(hasTrustedRuntimeAuthorization("Bearer incorrect", trusted.trustedToken)).toBe(false);
  });
});
