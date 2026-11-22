import type { Geometry } from "geojson";
import type maplibregl from "maplibre-gl";
import { type MutableRefObject, useEffect, useRef } from "react";

import {
  type AoiViewport,
  BASEMAP_SOURCE_ID,
  DRAFT_AOI_OUTLINE,
  PREPARED_AOI_OUTLINE,
  PROVIDER_PREFIX,
  REFERENCE_PREFIX,
} from "../../components/map/constants";
import { addProviderPresentationLayer } from "../../components/map/layerStyles";
import {
  addRasterTileReference,
  geometryBounds,
  providerSourceId,
  removePrefixedLayersAndSources,
  replaceAoiOutline,
  wmsTileUrl,
} from "../../components/map/mapHelpers";
import {
  KIUT_MAX_ZOOM,
  KIUT_MIN_ZOOM,
  KIUT_WMS_URL,
  type KiutReferenceLayer,
} from "../../kiutReference";
import { baseMapRasterPaint, openStreetMapBasemap, type VisualBasemapMode } from "../../mapStyle";
import {
  ORTHOPHOTO_MAX_ZOOM,
  ORTHOPHOTO_MIN_ZOOM,
  ORTHOPHOTO_WMTS_URL,
  orthophotoReference,
} from "../../orthophotoReference";
import { type PreviewLayer, type TransportRoadClass } from "../../previewCatalog";
import { toSafeRasterUrl } from "../../safeRasterProtocol";

export function useMapLayerSync({
  mapRef,
  mapReady,
  layers,
  transportRoadClasses,
  references,
  orthophotoEnabled,
  basemapMode,
  draftAoiOutline,
  preparedAoiOutline,
  aoiViewport,
}: {
  mapRef: MutableRefObject<maplibregl.Map | null>;
  mapReady: boolean;
  layers: PreviewLayer[];
  transportRoadClasses: Record<TransportRoadClass, boolean>;
  references: KiutReferenceLayer[];
  orthophotoEnabled: boolean;
  basemapMode: VisualBasemapMode;
  draftAoiOutline: Geometry | null;
  preparedAoiOutline: Geometry | null;
  aoiViewport: AoiViewport | null;
}): void {
  const fittedArchiveRef = useRef<string | null>(null);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) {
      return;
    }
    if (basemapMode === "none") {
      if (map.getLayer(BASEMAP_SOURCE_ID)) {
        map.removeLayer(BASEMAP_SOURCE_ID);
      }
      if (map.getSource(BASEMAP_SOURCE_ID)) {
        map.removeSource(BASEMAP_SOURCE_ID);
      }
      return;
    }
    if (!map.getSource(BASEMAP_SOURCE_ID)) {
      map.addSource(BASEMAP_SOURCE_ID, {
        type: "raster",
        tiles: [openStreetMapBasemap.tileUrlTemplate],
        tileSize: 256,
        attribution: openStreetMapBasemap.attribution,
        minzoom: openStreetMapBasemap.minZoom,
        maxzoom: openStreetMapBasemap.maxZoom,
      });
    }
    const paint = baseMapRasterPaint(basemapMode);
    if (!map.getLayer(BASEMAP_SOURCE_ID)) {
      map.addLayer({ id: BASEMAP_SOURCE_ID, type: "raster", source: BASEMAP_SOURCE_ID, paint });
      return;
    }
    Object.entries(paint).forEach(([property, value]) =>
      map.setPaintProperty(BASEMAP_SOURCE_ID, property, value),
    );
  }, [basemapMode, mapReady, mapRef]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) {
      return;
    }
    removePrefixedLayersAndSources(map, PROVIDER_PREFIX);
    const archives = new Map<string, PreviewLayer[]>();
    layers.forEach((layer) =>
      archives.set(layer.archiveUrl, [...(archives.get(layer.archiveUrl) ?? []), layer]),
    );
    archives.forEach((archiveLayers, archiveUrl) => {
      const sourceId = providerSourceId(archiveUrl);
      map.addSource(sourceId, {
        type: "vector",
        url: `pmtiles://${new URL(archiveUrl, window.location.origin).toString()}`,
        attribution:
          archiveLayers[0]?.artifact.attribution_html ?? archiveLayers[0]?.artifact.attribution,
        minzoom: archiveLayers[0]?.archiveMinZoom ?? 0,
        maxzoom: archiveLayers[0]?.archiveMaxZoom ?? 22,
      });
      archiveLayers.forEach((layer, index) =>
        addProviderPresentationLayer(map, layer, index, sourceId, transportRoadClasses),
      );
      const bounds = archiveLayers[0]?.archiveBounds;
      if (bounds && fittedArchiveRef.current !== archiveUrl) {
        map.fitBounds(
          [
            [bounds[0], bounds[1]],
            [bounds[2], bounds[3]],
          ],
          { padding: 28, maxZoom: 10 },
        );
        fittedArchiveRef.current = archiveUrl;
      }
    });
  }, [layers, mapReady, transportRoadClasses, mapRef]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) {
      return;
    }
    removePrefixedLayersAndSources(map, REFERENCE_PREFIX);
    if (orthophotoEnabled) {
      addRasterTileReference(
        map,
        "orthophoto",
        toSafeRasterUrl(ORTHOPHOTO_WMTS_URL),
        orthophotoReference.attribution,
        ORTHOPHOTO_MIN_ZOOM,
        ORTHOPHOTO_MAX_ZOOM,
      );
    }
    if (references.length > 0) {
      const combinedLayers = references.map((reference) => reference.wmsLayer).join(",");
      addRasterTileReference(
        map,
        "kiut",
        toSafeRasterUrl(wmsTileUrl(KIUT_WMS_URL, combinedLayers, "image/png")),
        "GUGiK, KIUT/GESUT WMS",
        KIUT_MIN_ZOOM,
        KIUT_MAX_ZOOM,
      );
    }
    if (references.length && map.getZoom() < KIUT_MIN_ZOOM) {
      map.setZoom(KIUT_MIN_ZOOM);
    }
  }, [references, orthophotoEnabled, mapReady, mapRef]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) {
      return;
    }
    replaceAoiOutline(map, PREPARED_AOI_OUTLINE, preparedAoiOutline);
    replaceAoiOutline(map, DRAFT_AOI_OUTLINE, draftAoiOutline);
  }, [draftAoiOutline, mapReady, preparedAoiOutline, mapRef]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !aoiViewport) {
      return;
    }
    const bounds = geometryBounds(aoiViewport.geometry);
    if (!bounds) {
      return;
    }
    map.easeTo({
      center: [(bounds[0] + bounds[2]) / 2, (bounds[1] + bounds[3]) / 2],
      zoom: aoiViewport.zoom,
      duration: 650,
      essential: true,
    });
  }, [aoiViewport, mapReady, mapRef]);
}
