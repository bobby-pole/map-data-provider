import { describe, expect, it } from "vitest";

import { getSourceProblemInfo } from "./sourceAvailability";

describe("SourceAvailabilitySection logic", () => {
  it("identifies an actionable gap in BDOT10k when uncovered", () => {
    const info = getSourceProblemInfo({
      source_id: "bdot10k",
      availability: "available",
      aoi_coverage: "uncovered",
      feature_state: "not_applicable",
      freshness: "fresh",
      evidence: "custom AOI outside BDOT10k package",
      actionable_gap: true,
    });
    expect(info.isProblem).toBe(true);
    expect(info.title).toBe("No Local Package in AOI");
    expect(info.severity).toBe("warning");
  });

  it("identifies demo/non-analytical fixture source", () => {
    const info = getSourceProblemInfo({
      source_id: "manual_power_seed",
      availability: "not_eligible",
      aoi_coverage: "not_applicable",
      feature_state: "not_applicable",
      freshness: "fresh",
      evidence: "local review input",
      actionable_gap: true,
    });
    expect(info.isProblem).toBe(true);
    expect(info.title).toBe("Demo Fixture (Non-analytical)");
    expect(info.severity).toBe("info");
  });

  it("identifies healthy available sources without problems", () => {
    const info = getSourceProblemInfo({
      source_id: "openstreetmap",
      availability: "available",
      aoi_coverage: "covered",
      feature_state: "available",
      freshness: "fresh",
      evidence: "live acquisition",
      actionable_gap: false,
    });
    expect(info.isProblem).toBe(false);
    expect(info.title).toBe("Operational");
  });

  it("identifies unavailable service as error", () => {
    const info = getSourceProblemInfo({
      source_id: "prg_wfs",
      availability: "unavailable",
      aoi_coverage: "covered",
      feature_state: "empty",
      freshness: "stale",
      evidence: "service down",
      actionable_gap: true,
    });
    expect(info.isProblem).toBe(true);
    expect(info.title).toBe("Service Unavailable");
    expect(info.severity).toBe("error");
  });
});
