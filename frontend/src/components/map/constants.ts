import type { Geometry } from "geojson";

import type { MapCircuit, MapCircuitMember } from "../../types/api";

export const PROVIDER_PREFIX = "provider:";
export const REFERENCE_PREFIX = "reference:";
export const BASEMAP_SOURCE_ID = "basemap:openstreetmap";

export const CIRCUIT_SOURCE_ID = "circuit:selected";
export const CIRCUIT_GLOW_OUTER_ID = "circuit:selected-glow-outer";
export const CIRCUIT_LINE_ID = "circuit:selected-line";
export const CIRCUIT_ENDPOINT_ID = "circuit:selected-endpoints";

export const CIRCUIT_MEMBER_SOURCE_ID = "circuit:selected-member";
export const CIRCUIT_MEMBER_GLOW_OUTER_ID = "circuit:selected-member-glow-outer";
export const CIRCUIT_MEMBER_HALO_ID = "circuit:selected-member-halo";
export const CIRCUIT_MEMBER_LINE_ID = "circuit:selected-member-line";
export const CIRCUIT_MEMBER_ENDPOINT_ID = "circuit:selected-member-endpoints";

export const SELECTED_FEATURE_SOURCE_ID = "selected:feature";
export const SELECTED_FEATURE_GLOW_OUTER_ID = "selected:feature-glow-outer";
export const SELECTED_FEATURE_LINE_ID = "selected:feature-line";
export const SELECTED_FEATURE_ENDPOINT_ID = "selected:feature-endpoints";

export type AoiOutlineStyle = {
  source: string;
  fill: string;
  line: string;
  color: string;
  fillOpacity: number;
  dash: number[];
};

export const DRAFT_AOI_OUTLINE: AoiOutlineStyle = {
  source: "aoi:draft",
  fill: "aoi:draft-fill",
  line: "aoi:draft-line",
  color: "#38bdf8",
  fillOpacity: 0.11,
  dash: [2, 1],
};

export const PREPARED_AOI_OUTLINE: AoiOutlineStyle = {
  source: "aoi:prepared",
  fill: "aoi:prepared-fill",
  line: "aoi:prepared-line",
  color: "#86efac",
  fillOpacity: 0.14,
  dash: [1.5, 1],
};

export const POPUP_FIELD_NAMES = [
  "power",
  "man_made",
  "industrial",
  "plant:source",
  "generator:source",
  "plant:output:heat",
  "generator:output:heat",
  "tower:type",
  "telecom",
  "communication",
  "communication:mobile_phone",
  "communication:radio",
  "communication:television",
  "communication:microwave",
  "cable",
  "amenity",
  "healthcare",
  "emergency",
  "highway",
  "railway",
  "aeroway",
  "road_class",
  "ref",
  "surface",
  "maxspeed",
  "lanes",
  "bridge",
  "tunnel",
  "oneway",
  "waterway",
  "pipeline",
  "substance",
  "diameter",
  "pumping",
  "gas",
  "pressure",
  "official_type",
  "iip_identifier",
  "jpt_id",
  "version_from",
  "voltage",
  "frequency",
  "operator",
  "circuits",
  "cables",
  "wires",
  "plant:method",
  "plant:output:electricity",
  "start_date",
  "description",
  "phone",
  "contact:phone",
  "opening_hours",
  "wheelchair",
];

export type AoiViewport = { geometry: Geometry; zoom: number };
export type RelatedLine = { circuit: MapCircuit; member: MapCircuitMember };
export type PowerPopupState = {
  sourceId: string;
  state: "loading" | "available" | "empty" | "unavailable";
  lines: RelatedLine[];
  detail?: string;
};
