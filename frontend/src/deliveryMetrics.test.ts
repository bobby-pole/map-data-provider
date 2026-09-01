import { describe, expect, it } from "vitest";

import { DEFAULT_DELIVERY_AOI_ID, isRuntimeAcquisitionReport } from "./deliveryReport";

describe("delivery report selection", () => {
  it("keeps the static benchmark for the default Rybnik snapshot", () => {
    expect(DEFAULT_DELIVERY_AOI_ID).toBe("rybnik_35km");
    expect(isRuntimeAcquisitionReport(DEFAULT_DELIVERY_AOI_ID)).toBe(false);
    expect(isRuntimeAcquisitionReport(null)).toBe(false);
  });

  it("uses AOI-scoped acquisition evidence for a prepared custom snapshot", () => {
    expect(isRuntimeAcquisitionReport("aoi_custom_123")).toBe(true);
  });
});
