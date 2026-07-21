import {
  ProviderDataError,
  getCachedLayer,
  getCachedLayers,
  getCachedReadiness,
  getSourcesForAoi,
} from "./providerDataService.js";
import { steelSentinelPackSchema } from "../types/provider.js";

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
