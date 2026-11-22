import { Fragment } from "react";

import type { SelectedProviderFeature } from "../../inspection";
import { popupDetails } from "../../previewCatalog";
import type { MapCircuit, MapCircuitMember, MapFeatureDetail } from "../../types/api";
import { CloseButton } from "../CloseButton";
import type { PowerPopupState, RelatedLine } from "./constants";
import {
  asStringRecord,
  formatVoltage,
  isValidHttpUrl,
  parseWikipediaUrl,
  popupAttributeEntries,
} from "./mapHelpers";

export function FeaturePopupPanel({
  selected,
  selectedDetail,
  selectedCircuit,
  selectedCircuitMember,
  selectedLineDetail,
  unavailableLineDetailForSourceId,
  powerPopup,
  onClose,
  onSelectCircuitLine,
  onDeselectCircuitMember,
  onZoom,
}: {
  selected: SelectedProviderFeature;
  selectedDetail: MapFeatureDetail | null;
  selectedCircuit: MapCircuit | null;
  selectedCircuitMember: MapCircuitMember | null;
  selectedLineDetail: MapFeatureDetail | null;
  unavailableLineDetailForSourceId: string | null;
  powerPopup: PowerPopupState | null;
  onClose: () => void;
  onSelectCircuitLine: (line: RelatedLine) => void;
  onDeselectCircuitMember: () => void;
  onZoom: () => void;
}) {
  const { layer } = selected;
  const detail =
    selectedDetail?.source_id === selected.feature.properties.source_id ? selectedDetail : null;
  const feature = detail ? detail.feature : selected.feature;
  const details = popupDetails(feature, layer);
  const properties = feature.properties;
  const tags = {
    ...asStringRecord(properties.osm_tags),
    ...asStringRecord(properties.source_attributes),
  };
  const sourceId = typeof properties.source_id === "string" ? properties.source_id : "";
  const sourceLink = /^((node|way|relation)\/\d+)$/.test(sourceId)
    ? `https://www.openstreetmap.org/${sourceId}`
    : null;

  const roadClass =
    typeof properties.road_class === "string"
      ? properties.road_class
      : typeof tags.highway === "string"
        ? tags.highway
        : undefined;
  const rawVoltage = properties.voltage_label ?? tags.voltage;
  const voltageLabel =
    typeof rawVoltage === "string" || typeof rawVoltage === "number"
      ? formatVoltage(String(rawVoltage))
      : "voltage unknown";
  const assetType = typeof properties.asset_type === "string" ? properties.asset_type : "feature";
  const featureName =
    typeof properties.name === "string"
      ? properties.name
      : typeof tags.name === "string"
        ? tags.name
        : details.title;
  const operatorOrSource = typeof tags.operator === "string" ? tags.operator : details.source;

  const classification =
    properties.domain === "power"
      ? voltageLabel
      : properties.domain === "transport" && roadClass
        ? `road (${roadClass})`
        : assetType.replaceAll("_", " ");

  const directLineDetail =
    selectedDetail?.source_id === selectedCircuitMember?.source_id ? selectedDetail : null;
  const inspectedLineDetail =
    directLineDetail ??
    (selectedLineDetail?.source_id === selectedCircuitMember?.source_id
      ? selectedLineDetail
      : null);

  const displayProperties = inspectedLineDetail
    ? inspectedLineDetail.feature.properties
    : properties;
  const attributeEntries = popupAttributeEntries(displayProperties);

  const isPower = layer.domain === "power";
  const relevantPowerPopup =
    powerPopup?.sourceId === selected.feature.properties.source_id ? powerPopup : null;

  const extLinks = [
    sourceLink && { href: sourceLink, label: "OpenStreetMap" },
    tags.website && isValidHttpUrl(tags.website) && { href: tags.website, label: "Website" },
    tags.wikipedia &&
      parseWikipediaUrl(tags.wikipedia) && {
        href: parseWikipediaUrl(tags.wikipedia)!,
        label: "Wikipedia",
      },
    tags.wikidata &&
      /^Q\d+$/.test(tags.wikidata) && {
        href: `https://www.wikidata.org/wiki/${tags.wikidata}`,
        label: "Wikidata",
      },
    tags.image && isValidHttpUrl(tags.image) && { href: tags.image, label: "Source image" },
  ].filter(Boolean) as Array<{ href: string; label: string }>;

  return (
    <section
      className={`mapFeaturePanel ${isPower ? "isPower" : ""}`}
      aria-label="Selected feature details"
    >
      <CloseButton
        className="mapFeaturePanelClose"
        ariaLabel="Close feature details"
        title="Close feature details"
        onClick={onClose}
      />

      <header className="mapFeaturePanelHeader">
        <strong>{featureName}</strong>
        <span className="mapFeaturePanelSubtitle">
          {classification} · {operatorOrSource}
        </span>
      </header>

      <div className="mapFeaturePanelMeta">
        {sourceLink ? (
          <span className="mapFeaturePanelSourceId">
            <a href={sourceLink} target="_blank" rel="noreferrer">
              {sourceId}
            </a>
          </span>
        ) : (
          sourceId && <span className="mapFeaturePanelSourceId">{sourceId}</span>
        )}

        {extLinks.length > 0 && (
          <div className="mapFeaturePanelLinks">
            {extLinks.map((link, idx) => (
              <Fragment key={link.label}>
                {idx > 0 && <span>·</span>}
                <a href={link.href} target="_blank" rel="noreferrer">
                  {link.label}
                </a>
              </Fragment>
            ))}
          </div>
        )}
      </div>

      {selectedCircuitMember && (
        <div className="circuitMemberBadge">
          <span>
            Selected line: <strong>{selectedCircuitMember.source_id}</strong>
          </span>
          <button type="button" onClick={onDeselectCircuitMember}>
            Show full circuit
          </button>
        </div>
      )}

      {attributeEntries.length > 0 && (
        <section className="mapFeaturePanelSection">
          <span className="mapFeaturePanelSectionTitle">Attributes</span>
          <dl className="mapFeaturePanelDl">
            {attributeEntries.map(([name, value]) => (
              <Fragment key={name}>
                <dt>{name}</dt>
                <dd>{name === "voltage" ? formatVoltage(value) : value}</dd>
              </Fragment>
            ))}
          </dl>
          {selectedCircuitMember && !inspectedLineDetail && (
            <small className="muted">
              {unavailableLineDetailForSourceId === selectedCircuitMember.source_id
                ? "Full source attributes are unavailable for this cached line."
                : "Loading source attributes…"}
            </small>
          )}
        </section>
      )}

      {isPower && (
        <section className="mapFeaturePanelSection">
          <span className="mapFeaturePanelSectionTitle">Verified circuit lines</span>
          {!relevantPowerPopup || relevantPowerPopup.state === "loading" ? (
            <small className="muted">Loading committed circuit evidence…</small>
          ) : relevantPowerPopup.state === "available" ? (
            <div className="popupCircuitList">
              {relevantPowerPopup.lines.map((line) => {
                const isMemberSelected = selectedCircuitMember?.source_id === line.member.source_id;
                return (
                  <button
                    key={line.member.source_id}
                    type="button"
                    className={`popupCircuitButton ${isMemberSelected ? "active" : ""}`}
                    onClick={() => onSelectCircuitLine(line)}
                  >
                    <strong>Line {line.member.source_id}</strong>
                    <small>
                      {String(line.circuit.tags.name ?? line.circuit.relation_id)}
                      {line.member.endpoint_evidence
                        ? ` · ${line.member.endpoint_evidence.start} → ${line.member.endpoint_evidence.end}`
                        : " · source geometry verified"}
                    </small>
                  </button>
                );
              })}
            </div>
          ) : (
            <small className="muted">
              {relevantPowerPopup.state === "empty"
                ? "No committed circuit line is available for this feature."
                : (relevantPowerPopup.detail ??
                  "Circuit evidence is unavailable for this cached snapshot.")}
            </small>
          )}
        </section>
      )}

      <div className="mapFeaturePanelActions">
        <button type="button" className="mapFeaturePanelZoomBtn" onClick={onZoom}>
          Zoom to {selectedCircuitMember ? "line" : selectedCircuit ? "circuit" : "feature"}
        </button>
      </div>
    </section>
  );
}
