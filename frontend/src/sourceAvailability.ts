import type { SourceAvailabilityReport } from "./types/api";

export type SourceEntry = SourceAvailabilityReport["sources"][number];

export const SOURCE_FRIENDLY_NAMES: Record<string, string> = {
  openstreetmap: "OpenStreetMap (OSM)",
  prg_wfs: "PRG (National Boundaries & Points)",
  bdot10k: "BDOT10k (Topographic Database)",
  manual_power_seed: "Manual Demo Seed",
  kiut_gesut_wms: "KIUT / GESUT WMS",
  geoportal_orthophoto: "Geoportal High-Res Orthophoto",
  nmt_nmpt: "NMT / NMPT Terrain Elevation",
};

export function getSourceProblemInfo(source: SourceEntry): {
  isProblem: boolean;
  title: string;
  explanation: string;
  severity: "error" | "warning" | "info";
} {
  if (source.availability === "unavailable") {
    return {
      isProblem: true,
      title: "Service Unavailable",
      explanation: "Remote provider service is offline or unreachable. No features could be acquired.",
      severity: "error",
    };
  }

  if (source.source_id === "bdot10k" && source.aoi_coverage === "uncovered") {
    return {
      isProblem: true,
      title: "No Local Package in AOI",
      explanation: "BDOT10k official vector data package is not loaded for this custom boundary. Analysis relies on active OSM and PRG data.",
      severity: "warning",
    };
  }

  if (source.source_id === "manual_power_seed" || source.availability === "not_eligible") {
    return {
      isProblem: true,
      title: "Demo Fixture (Non-analytical)",
      explanation: "Local demonstration fixture; excluded from official public analytical outputs.",
      severity: "info",
    };
  }

  if (source.freshness === "stale") {
    return {
      isProblem: true,
      title: "Outdated Snapshot",
      explanation: "Cached source data is older than the configured freshness threshold.",
      severity: "warning",
    };
  }

  if (source.actionable_gap) {
    return {
      isProblem: true,
      title: "Actionable Source Gap",
      explanation: source.evidence || "Source requires attention or missing infrastructure coverage.",
      severity: "warning",
    };
  }

  if (source.aoi_coverage === "uncovered" && source.availability !== "reference_only") {
    return {
      isProblem: true,
      title: "Uncovered AOI",
      explanation: "Source coverage does not extend to this geographic boundary.",
      severity: "warning",
    };
  }

  return {
    isProblem: false,
    title: "Operational",
    explanation: "Source is available, covered, and healthy.",
    severity: "info",
  };
}
