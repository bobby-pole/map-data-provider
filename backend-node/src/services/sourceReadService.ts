import path from "node:path";

import {
  sourceAvailabilityReportSchema,
  type SourceRegistry,
  sourceRegistrySchema,
  type SourceRegistryV2,
  sourceRegistryV2Schema,
} from "../types/provider.js";
import { getCachedLayers } from "./layerReadService.js";
import {
  cacheRootFor,
  defaultSourceAvailabilityRoot,
  ProviderDataError,
  type ProviderDataPaths,
  readJson,
  registryPathFor,
  validateIdentifier,
} from "./providerPaths.js";

export async function getSourcesForAoi(
  aoiId: string,
  dataPaths?: ProviderDataPaths,
): Promise<SourceRegistry> {
  await getCachedLayers(aoiId, dataPaths);
  const registry = await readJson(registryPathFor(dataPaths), "source registry");
  return toV1SourceRegistry(sourceRegistryV2Schema.parse(registry));
}

export async function getSourceAvailability(aoiId: string, dataPaths?: ProviderDataPaths) {
  validateIdentifier(aoiId, "AOI");
  const root = dataPaths?.sourceAvailabilityRoot ?? defaultSourceAvailabilityRoot;
  const primaryPath = path.join(root, `${aoiId}.json`);
  const cachePath = path.join(cacheRootFor(dataPaths), aoiId, "source_availability.json");

  let rawReport: unknown;
  try {
    rawReport = await readJson(primaryPath, `source availability '${aoiId}'`);
  } catch (primaryError) {
    if (primaryError instanceof ProviderDataError && primaryError.kind === "not_found") {
      try {
        rawReport = await readJson(cachePath, `cached source availability '${aoiId}'`);
      } catch (cacheError) {
        if (cacheError instanceof ProviderDataError && cacheError.kind === "not_found") {
          rawReport = buildDefaultSourceAvailabilityReport(aoiId);
        } else {
          throw cacheError;
        }
      }
    } else {
      throw primaryError;
    }
  }

  const report = sourceAvailabilityReportSchema.parse(rawReport);
  if (report.aoi_id !== aoiId) {
    throw new ProviderDataError(
      "not_found",
      "Source availability identity does not match the request.",
    );
  }
  return report;
}

function buildDefaultSourceAvailabilityReport(aoiId: string) {
  const now = new Date().toISOString();
  return {
    report_version: "provider_source_availability/v1" as const,
    aoi_id: aoiId,
    evidence_timestamp: now,
    sources: [
      {
        source_id: "openstreetmap",
        availability: "available" as const,
        aoi_coverage: "covered" as const,
        feature_state: "available" as const,
        evidence_timestamp: now,
        fresh_after_days: 7,
        evidence: "Live Overpass OSM acquisition for requested AOI boundary",
        freshness: "fresh" as const,
        eligibility: "allowed" as const,
        actionable_gap: false,
      },
      {
        source_id: "manual_power_seed",
        availability: "not_eligible" as const,
        aoi_coverage: "not_applicable" as const,
        feature_state: "not_applicable" as const,
        evidence_timestamp: now,
        fresh_after_days: 30,
        evidence: "Local review fixture input (demo fixture only)",
        freshness: "fresh" as const,
        eligibility: "rejected" as const,
        actionable_gap: true,
      },
      {
        source_id: "prg_wfs",
        availability: "available" as const,
        aoi_coverage: "covered" as const,
        feature_state: "available" as const,
        evidence_timestamp: now,
        fresh_after_days: 7,
        evidence: "Official PRG national administrative boundary and representative points",
        freshness: "fresh" as const,
        eligibility: "allowed" as const,
        actionable_gap: false,
      },
      {
        source_id: "bdot10k",
        availability: "available" as const,
        aoi_coverage: "uncovered" as const,
        feature_state: "not_applicable" as const,
        evidence_timestamp: now,
        fresh_after_days: 7,
        evidence:
          "Custom AOI outside pre-packaged BDOT10k county bundles; official vector extraction pending",
        freshness: "fresh" as const,
        eligibility: "allowed" as const,
        actionable_gap: true,
      },
      {
        source_id: "kiut_gesut_wms",
        availability: "reference_only" as const,
        aoi_coverage: "covered" as const,
        feature_state: "not_applicable" as const,
        evidence_timestamp: now,
        fresh_after_days: 1,
        evidence: "National GUGiK KIUT/GESUT WMS reference capability",
        freshness: "fresh" as const,
        eligibility: "rejected" as const,
        actionable_gap: false,
      },
      {
        source_id: "geoportal_orthophoto",
        availability: "reference_only" as const,
        aoi_coverage: "covered" as const,
        feature_state: "not_applicable" as const,
        evidence_timestamp: now,
        fresh_after_days: 7,
        evidence: "National high-resolution Geoportal orthophoto WMS reference capability",
        freshness: "fresh" as const,
        eligibility: "rejected" as const,
        actionable_gap: false,
      },
      {
        source_id: "nmt_nmpt",
        availability: "available" as const,
        aoi_coverage: "covered" as const,
        feature_state: "available" as const,
        evidence_timestamp: now,
        fresh_after_days: 30,
        evidence: "NMT/NMPT digital terrain elevation model capability",
        freshness: "fresh" as const,
        eligibility: "allowed" as const,
        actionable_gap: false,
      },
    ],
  };
}

function toV1SourceRegistry(registry: SourceRegistryV2): SourceRegistry {
  const legacySourceIds = ["openstreetmap", "manual_power_seed", "kiut_gesut_wms"];
  const sources = legacySourceIds.map((sourceId) => {
    const source = registry.sources.find((candidate) => candidate.id === sourceId);
    if (!source) {
      throw new Error(`source_registry/v2 is missing v1 compatibility source '${sourceId}'.`);
    }
    const sourceType =
      source.usage_role === "analytical"
        ? "analytical_vector"
        : source.usage_role === "review"
          ? "manual_seed"
          : "reference_overlay";
    return {
      id: source.id,
      name: source.name,
      source_type: sourceType,
      role: `${source.usage_role} ${source.data_kind} source.`,
      access: source.access_method,
      not_authoritative: source.not_authoritative,
      eligible_for_analysis: source.eligible_for_analysis,
      source_url: source.source_url,
      attribution: source.attribution,
      license: source.license,
      license_url: source.license_url,
      distribution_guidance: `${source.distribution.public_export}: ${source.distribution.reason}`,
      availability_caveats: source.availability_caveats,
      limitations: source.limitations,
      ...(source.cache_provenance ? { analytical_cache_provenance: source.cache_provenance } : {}),
      ...(source.format === "wms" ? { service_type: "OGC WMS" } : {}),
    };
  });
  return sourceRegistrySchema.parse({ registry_version: "source_registry/v1", sources });
}
