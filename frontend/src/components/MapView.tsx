import "maplibre-gl/dist/maplibre-gl.css";

import type { Geometry } from "geojson";
import maplibregl from "maplibre-gl";
import { Protocol } from "pmtiles";
import { useEffect, useRef, useState } from "react";

import { useMapLayerSync } from "../hooks/map/useMapLayerSync";
import { useMapSelectionHighlight } from "../hooks/map/useMapSelectionHighlight";
import { usePowerCircuitPopup } from "../hooks/map/usePowerCircuitPopup";
import type { SelectedProviderFeature } from "../inspection";
import { type KiutReferenceLayer } from "../kiutReference";
import { type VisualBasemapMode } from "../mapStyle";
import { type PreviewLayer, type TransportRoadClass } from "../previewCatalog";
import { safeRasterProtocol } from "../safeRasterProtocol";
import type { MapCircuit, MapCircuitMember, MapFeatureDetail } from "../types/api";
import { type AoiViewport } from "./map/constants";
import { FeaturePopupPanel } from "./map/FeaturePopupPanel";
import {
  asProviderFeature,
  providerInteractiveLayerIds,
  registerMapSymbols,
} from "./map/mapHelpers";

const pmtilesProtocol = new Protocol();
maplibregl.addProtocol("pmtiles", pmtilesProtocol.tile);
maplibregl.addProtocol("safe-raster", safeRasterProtocol);

export type { AoiViewport };

export function MapView({
  aoiId,
  layers,
  transportRoadClasses,
  references,
  orthophotoEnabled,
  basemapMode,
  draftAoiOutline,
  preparedAoiOutline,
  aoiViewport,
  selected,
  selectedDetail,
  selectedCircuit,
  selectedCircuitMember,
  pickingAoi,
  onSelectFeature,
  onCircuitChange,
  onCircuitMemberChange,
  onPickAoiPoint,
  onZoomChange,
}: {
  aoiId?: string;
  layers: PreviewLayer[];
  transportRoadClasses: Record<TransportRoadClass, boolean>;
  references: KiutReferenceLayer[];
  orthophotoEnabled: boolean;
  basemapMode: VisualBasemapMode;
  draftAoiOutline: Geometry | null;
  preparedAoiOutline: Geometry | null;
  aoiViewport: AoiViewport | null;
  selected: SelectedProviderFeature | null;
  selectedDetail: MapFeatureDetail | null;
  selectedCircuit: MapCircuit | null;
  selectedCircuitMember: MapCircuitMember | null;
  pickingAoi: boolean;
  onSelectFeature: (selected: SelectedProviderFeature | null) => void;
  onCircuitChange: (circuit: MapCircuit | null) => void;
  onCircuitMemberChange: (member: MapCircuitMember | null) => void;
  onPickAoiPoint: (point: { longitude: number; latitude: number }) => void;
  onZoomChange: (zoom: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const layersRef = useRef(layers);
  const onSelectFeatureRef = useRef(onSelectFeature);
  const onCircuitChangeRef = useRef(onCircuitChange);
  const onPickAoiPointRef = useRef(onPickAoiPoint);
  const onZoomChangeRef = useRef(onZoomChange);
  const pickingAoiRef = useRef(pickingAoi);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    layersRef.current = layers;
  }, [layers]);
  useEffect(() => {
    onSelectFeatureRef.current = onSelectFeature;
  }, [onSelectFeature]);
  useEffect(() => {
    onCircuitChangeRef.current = onCircuitChange;
  }, [onCircuitChange]);
  useEffect(() => {
    onPickAoiPointRef.current = onPickAoiPoint;
  }, [onPickAoiPoint]);
  useEffect(() => {
    onZoomChangeRef.current = onZoomChange;
  }, [onZoomChange]);
  useEffect(() => {
    pickingAoiRef.current = pickingAoi;
  }, [pickingAoi]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) {
      return;
    }
    const map = new maplibregl.Map({
      container: containerRef.current,
      center: [19.35, 52.05],
      zoom: 5.5,
      style: {
        version: 8,
        sources: {},
        layers: [
          { id: "background", type: "background", paint: { "background-color": "#0b1728" } },
        ],
      },
    });
    mapRef.current = map;
    void map.once("load", () => {
      void registerMapSymbols(map).finally(() => {
        onZoomChangeRef.current(map.getZoom());
        setMapReady(true);
      });
    });
    map.on("zoom", () => onZoomChangeRef.current(map.getZoom()));
    map.on("click", (event) => {
      if (pickingAoiRef.current) {
        onPickAoiPointRef.current({
          longitude: Number(event.lngLat.lng.toFixed(6)),
          latitude: Number(event.lngLat.lat.toFixed(6)),
        });
        return;
      }
      const visibleIds = layersRef.current
        .flatMap(providerInteractiveLayerIds)
        .filter((id) => map.getLayer(id));
      const rendered = map.queryRenderedFeatures(event.point, { layers: visibleIds })[0];
      if (!rendered) {
        return;
      }
      const layer = layersRef.current.find(
        (candidate) => candidate.artifact.source_layer === rendered.sourceLayer,
      );
      if (!layer) {
        return;
      }
      const feature = asProviderFeature(rendered);
      onSelectFeatureRef.current({ layer, feature });
    });
    map.on("mousemove", (event) => {
      const visibleIds = layersRef.current
        .flatMap(providerInteractiveLayerIds)
        .filter((id) => map.getLayer(id));
      map.getCanvas().style.cursor =
        visibleIds.length && map.queryRenderedFeatures(event.point, { layers: visibleIds }).length
          ? "pointer"
          : "";
    });
    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  const { powerPopup, selectedLineDetail, unavailableLineDetailForSourceId } = usePowerCircuitPopup(
    {
      aoiId,
      selected,
      selectedCircuitMember,
      onCircuitChangeRef,
    },
  );

  useMapLayerSync({
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
  });

  const { zoomToSelected } = useMapSelectionHighlight({
    mapRef,
    mapReady,
    layers,
    selected,
    selectedDetail,
    selectedCircuit,
    selectedCircuitMember,
  });

  const clearSelection = () => {
    onSelectFeature(null);
    onCircuitChange(null);
    onCircuitMemberChange(null);
  };

  return (
    <div className="mapPanel">
      {selected && (
        <FeaturePopupPanel
          selected={selected}
          selectedDetail={selectedDetail}
          selectedCircuit={selectedCircuit}
          selectedCircuitMember={selectedCircuitMember}
          selectedLineDetail={selectedLineDetail}
          unavailableLineDetailForSourceId={unavailableLineDetailForSourceId}
          powerPopup={powerPopup}
          onClose={clearSelection}
          onSelectCircuitLine={(line) => {
            onCircuitChange(line.circuit);
            onCircuitMemberChange(line.member);
          }}
          onDeselectCircuitMember={() => onCircuitMemberChange(null)}
          onZoom={zoomToSelected}
        />
      )}
      <div className="map" ref={containerRef} />
    </div>
  );
}
