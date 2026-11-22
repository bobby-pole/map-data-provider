import type { Geometry } from "geojson";
import type maplibregl from "maplibre-gl";
import { type MutableRefObject, useEffect } from "react";

import {
  CIRCUIT_ENDPOINT_ID,
  CIRCUIT_GLOW_OUTER_ID,
  CIRCUIT_LINE_ID,
  CIRCUIT_MEMBER_ENDPOINT_ID,
  CIRCUIT_MEMBER_GLOW_OUTER_ID,
  CIRCUIT_MEMBER_HALO_ID,
  CIRCUIT_MEMBER_LINE_ID,
  CIRCUIT_MEMBER_SOURCE_ID,
  CIRCUIT_SOURCE_ID,
  SELECTED_FEATURE_ENDPOINT_ID,
  SELECTED_FEATURE_GLOW_OUTER_ID,
  SELECTED_FEATURE_LINE_ID,
  SELECTED_FEATURE_SOURCE_ID,
} from "../../components/map/constants";
import { firstProviderInteractiveLayerId, geometryBounds } from "../../components/map/mapHelpers";
import type { SelectedProviderFeature } from "../../inspection";
import { isPopupOnlyNetworkArtifact } from "../../presentationSemantics";
import type { PreviewLayer } from "../../previewCatalog";
import type { MapCircuit, MapCircuitMember, MapFeatureDetail } from "../../types/api";

function clearHighlightLayers(map: maplibregl.Map, layerIds: string[], sourceId: string): void {
  for (const layerId of layerIds) {
    if (map.getLayer(layerId)) {
      map.removeLayer(layerId);
    }
  }
  if (map.getSource(sourceId)) {
    map.removeSource(sourceId);
  }
}

export function useMapSelectionHighlight({
  mapRef,
  mapReady,
  layers,
  selected,
  selectedDetail,
  selectedCircuit,
  selectedCircuitMember,
}: {
  mapRef: MutableRefObject<maplibregl.Map | null>;
  mapReady: boolean;
  layers: PreviewLayer[];
  selected: SelectedProviderFeature | null;
  selectedDetail: MapFeatureDetail | null;
  selectedCircuit: MapCircuit | null;
  selectedCircuitMember: MapCircuitMember | null;
}): { zoomToSelected: () => void } {
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) {
      return;
    }
    clearHighlightLayers(
      map,
      [CIRCUIT_ENDPOINT_ID, CIRCUIT_LINE_ID, CIRCUIT_GLOW_OUTER_ID],
      CIRCUIT_SOURCE_ID,
    );
    if (!selectedCircuit || selectedCircuitMember) {
      return;
    }
    const members = selectedCircuit.members.filter((member) => member.geometry);
    const lines = members.map((member) => ({
      type: "Feature" as const,
      properties: { source_id: member.source_id, role: member.role },
      geometry: member.geometry!,
    }));
    const endpoints = members.flatMap((member) => {
      const coordinates = member.geometry!.coordinates;
      return [coordinates[0], coordinates.at(-1)!].map((coordinate) => ({
        type: "Feature" as const,
        properties: { source_id: member.source_id },
        geometry: { type: "Point" as const, coordinates: coordinate },
      }));
    });
    map.addSource(CIRCUIT_SOURCE_ID, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [...lines, ...endpoints] },
    });
    const beforeId = firstProviderInteractiveLayerId(map);
    map.addLayer(
      {
        id: CIRCUIT_GLOW_OUTER_ID,
        type: "line",
        source: CIRCUIT_SOURCE_ID,
        filter: ["==", ["geometry-type"], "LineString"],
        paint: {
          "line-color": "#facc15",
          "line-width": 13,
          "line-opacity": 0.65,
          "line-blur": 3.5,
        },
      },
      beforeId,
    );
    map.addLayer(
      {
        id: CIRCUIT_LINE_ID,
        type: "line",
        source: CIRCUIT_SOURCE_ID,
        filter: ["==", ["geometry-type"], "LineString"],
        paint: {
          "line-color": "#fef08a",
          "line-width": 7.5,
          "line-opacity": 0.9,
          "line-blur": 0.6,
        },
      },
      beforeId,
    );
    map.addLayer({
      id: CIRCUIT_ENDPOINT_ID,
      type: "circle",
      source: CIRCUIT_SOURCE_ID,
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-color": "rgba(250, 204, 21, 0.25)",
        "circle-radius": 6.5,
        "circle-stroke-color": "#fde047",
        "circle-stroke-width": 2,
      },
    });
  }, [mapReady, selectedCircuit, selectedCircuitMember, layers, mapRef]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) {
      return;
    }
    clearHighlightLayers(
      map,
      [
        CIRCUIT_MEMBER_ENDPOINT_ID,
        CIRCUIT_MEMBER_LINE_ID,
        CIRCUIT_MEMBER_HALO_ID,
        CIRCUIT_MEMBER_GLOW_OUTER_ID,
      ],
      CIRCUIT_MEMBER_SOURCE_ID,
    );
    if (!selectedCircuitMember?.geometry) {
      return;
    }
    const coordinates = selectedCircuitMember.geometry.coordinates;
    map.addSource(CIRCUIT_MEMBER_SOURCE_ID, {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { source_id: selectedCircuitMember.source_id },
            geometry: selectedCircuitMember.geometry,
          },
          {
            type: "Feature",
            properties: { endpoint: "start" },
            geometry: { type: "Point", coordinates: coordinates[0] },
          },
          {
            type: "Feature",
            properties: { endpoint: "end" },
            geometry: { type: "Point", coordinates: coordinates.at(-1)! },
          },
        ],
      },
    });
    const beforeId = firstProviderInteractiveLayerId(map);
    map.addLayer(
      {
        id: CIRCUIT_MEMBER_GLOW_OUTER_ID,
        type: "line",
        source: CIRCUIT_MEMBER_SOURCE_ID,
        filter: ["==", ["geometry-type"], "LineString"],
        paint: { "line-color": "#f59e0b", "line-width": 15, "line-opacity": 0.7, "line-blur": 4 },
      },
      beforeId,
    );
    map.addLayer(
      {
        id: CIRCUIT_MEMBER_HALO_ID,
        type: "line",
        source: CIRCUIT_MEMBER_SOURCE_ID,
        filter: ["==", ["geometry-type"], "LineString"],
        paint: {
          "line-color": "#fde047",
          "line-width": 8.5,
          "line-opacity": 0.95,
          "line-blur": 0.5,
        },
      },
      beforeId,
    );
    map.addLayer({
      id: CIRCUIT_MEMBER_ENDPOINT_ID,
      type: "circle",
      source: CIRCUIT_MEMBER_SOURCE_ID,
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-color": "rgba(245, 158, 11, 0.35)",
        "circle-radius": 7.5,
        "circle-stroke-color": "#fef08a",
        "circle-stroke-width": 2.5,
      },
    });
  }, [mapReady, selectedCircuitMember, layers, mapRef]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) {
      return;
    }
    clearHighlightLayers(
      map,
      [SELECTED_FEATURE_ENDPOINT_ID, SELECTED_FEATURE_LINE_ID, SELECTED_FEATURE_GLOW_OUTER_ID],
      SELECTED_FEATURE_SOURCE_ID,
    );
    const detail =
      selectedDetail?.source_id === selected?.feature.properties.source_id ? selectedDetail : null;
    const feature = detail ? detail.feature : selected?.feature;
    if (
      !feature?.geometry ||
      (feature.geometry.type !== "LineString" && feature.geometry.type !== "MultiLineString") ||
      isPopupOnlyNetworkArtifact(selected?.layer.artifact.artifact_id ?? "") ||
      (selected?.layer.domain === "power" && selectedCircuitMember)
    ) {
      return;
    }
    const features: Array<{
      type: "Feature";
      properties: Record<string, unknown>;
      geometry: Geometry;
    }> = [{ type: "Feature", properties: {}, geometry: feature.geometry }];
    if (feature.geometry.type === "LineString") {
      const coords = feature.geometry.coordinates;
      if (coords.length > 0) {
        features.push({
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: coords[0] },
        });
        features.push({
          type: "Feature",
          properties: {},
          geometry: { type: "Point", coordinates: coords[coords.length - 1] },
        });
      }
    }
    map.addSource(SELECTED_FEATURE_SOURCE_ID, {
      type: "geojson",
      data: { type: "FeatureCollection", features },
    });
    const beforeId = firstProviderInteractiveLayerId(map);
    const isPower = selected?.layer.domain === "power";
    const glowColor = isPower ? "#facc15" : "#38bdf8";
    const haloColor = isPower ? "#fef08a" : "#7dd3fc";

    map.addLayer(
      {
        id: SELECTED_FEATURE_GLOW_OUTER_ID,
        type: "line",
        source: SELECTED_FEATURE_SOURCE_ID,
        filter: ["in", ["geometry-type"], ["literal", ["LineString", "MultiLineString"]]],
        paint: {
          "line-color": glowColor,
          "line-width": 13,
          "line-opacity": 0.65,
          "line-blur": 3.5,
        },
      },
      beforeId,
    );
    map.addLayer(
      {
        id: SELECTED_FEATURE_LINE_ID,
        type: "line",
        source: SELECTED_FEATURE_SOURCE_ID,
        filter: ["in", ["geometry-type"], ["literal", ["LineString", "MultiLineString"]]],
        paint: {
          "line-color": haloColor,
          "line-width": 7.5,
          "line-opacity": 0.9,
          "line-blur": 0.6,
        },
      },
      beforeId,
    );
    map.addLayer({
      id: SELECTED_FEATURE_ENDPOINT_ID,
      type: "circle",
      source: SELECTED_FEATURE_SOURCE_ID,
      filter: ["==", ["geometry-type"], "Point"],
      paint: {
        "circle-color": isPower ? "rgba(250, 204, 21, 0.25)" : "rgba(56, 189, 248, 0.25)",
        "circle-radius": 6.5,
        "circle-stroke-color": haloColor,
        "circle-stroke-width": 2,
      },
    });
  }, [mapReady, selected, selectedDetail, selectedCircuitMember, layers, mapRef]);

  const zoomToSelected = () => {
    const map = mapRef.current;
    if (!map) {
      return;
    }

    if (selectedCircuitMember?.geometry) {
      const bounds = geometryBounds(selectedCircuitMember.geometry);
      if (bounds) {
        map.fitBounds(
          [
            [bounds[0], bounds[1]],
            [bounds[2], bounds[3]],
          ],
          {
            padding: { top: 96, right: 380, bottom: 96, left: 84 },
            maxZoom: 15,
            duration: 500,
            essential: true,
          },
        );
        return;
      }
    }

    if (selectedCircuit?.members) {
      const memberGeoms = selectedCircuit.members.filter((m) => m.geometry).map((m) => m.geometry!);
      if (memberGeoms.length > 0) {
        const collection: Geometry = {
          type: "GeometryCollection",
          geometries: memberGeoms,
        };
        const bounds = geometryBounds(collection);
        if (bounds) {
          map.fitBounds(
            [
              [bounds[0], bounds[1]],
              [bounds[2], bounds[3]],
            ],
            {
              padding: { top: 96, right: 380, bottom: 96, left: 84 },
              maxZoom: 14,
              duration: 500,
              essential: true,
            },
          );
          return;
        }
      }
    }

    const detail =
      selectedDetail?.source_id === selected?.feature.properties.source_id ? selectedDetail : null;
    const feature = detail ? detail.feature : selected?.feature;
    if (feature?.geometry) {
      const bounds = geometryBounds(feature.geometry);
      if (bounds) {
        if (bounds[0] === bounds[2] && bounds[1] === bounds[3]) {
          map.easeTo({
            center: [bounds[0], bounds[1]],
            zoom: Math.max(map.getZoom(), 15),
            duration: 500,
            essential: true,
          });
        } else {
          map.fitBounds(
            [
              [bounds[0], bounds[1]],
              [bounds[2], bounds[3]],
            ],
            {
              padding: { top: 96, right: 380, bottom: 96, left: 84 },
              maxZoom: 15,
              duration: 500,
              essential: true,
            },
          );
        }
      }
    }
  };

  return { zoomToSelected };
}
