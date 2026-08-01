import {
  ProviderDataError,
  getCachedLayer,
  getCachedLayers,
  getCachedReadiness,
  getDomainPacks,
  getSourcesForAoi,
  type ProviderDataPaths,
} from "./providerDataService.js";
import { steelSentinelPackSchema, steelSentinelPackV2Schema } from "../types/provider.js";

export async function buildSteelSentinelPack(aoiId: string) {
  const [layers, readiness, sources, layer] = await Promise.all([
    getCachedLayers(aoiId),
    getCachedReadiness(aoiId),
    getSourcesForAoi(aoiId),
    getCachedLayer(aoiId, "power"),
  ]);
  const metadata = layers.find((entry) => entry.domain === "power");
  const powerReadiness = readiness.find((entry) => entry.domain === "power");
  if (!metadata || !powerReadiness) {
    throw new ProviderDataError("not_found", `Incomplete cached power package for AOI '${aoiId}'.`);
  }
  if (layer.metadata.aoi_id !== aoiId || metadata.aoi_id !== aoiId || powerReadiness.aoi_id !== aoiId) {
    throw new ProviderDataError("not_found", "Cached package AOI identity does not match the request.");
  }
  return steelSentinelPackSchema.parse({
    contract_version: "steel_sentinel_pack/v1",
    aoi_id: aoiId,
    domains: ["power"],
    layers: { power: { layer, metadata, readiness: powerReadiness } },
    sources,
  });
}

export async function buildSteelSentinelPackV2(aoiId: string, dataPaths?: ProviderDataPaths) {
  const domainPacks = await getDomainPacks(aoiId, dataPaths);
  const sources = new Map(
    domainPacks
      .flatMap((pack) => pack.sources)
      .map((source) => [source.id, source]),
  );
  return steelSentinelPackV2Schema.parse({
    contract_version: "steel_sentinel_pack/v2",
    aoi_id: aoiId,
    domain_packs: domainPacks,
    sources: [...sources.values()].sort((left, right) => left.id.localeCompare(right.id)),
  });
}
