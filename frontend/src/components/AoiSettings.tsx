import { useEffect, useMemo, useRef, useState } from "react";

import type { AdministrativeUnit, ProviderRuntimeJob, ProviderRuntimeResponse } from "../types/api";
import { administrativeSelectionRoots, isPointRadiusValid } from "../aoiSettings";
import { ALL_RUNTIME_CATEGORIES, useAoiStore } from "../stores/aoiStore";
import type { ActivityEvent } from "./ActivityWindow";

type Props = {
  onActivity: (event: Omit<ActivityEvent, "id" | "timestamp">) => void;
  onApplied: (result: ProviderRuntimeResponse) => void;
  onResetToDefault?: () => void;
  isDefaultAoiActive?: boolean;
};

export function AoiSettings({ onActivity, onApplied, onResetToDefault, isDefaultAoiActive = true }: Props) {
  const catalog = useAoiStore((s) => s.catalog);
  const loadCatalog = useAoiStore((s) => s.loadCatalog);
  const mode = useAoiStore((s) => s.mode);
  const setMode = useAoiStore((s) => s.setMode);
  const longitude = useAoiStore((s) => s.longitude);
  const setLongitude = useAoiStore((s) => s.setLongitude);
  const latitude = useAoiStore((s) => s.latitude);
  const setLatitude = useAoiStore((s) => s.setLatitude);
  const radius = useAoiStore((s) => s.radius);
  const setRadius = useAoiStore((s) => s.setRadius);
  const unitIds = useAoiStore((s) => s.unitIds);
  const setUnitIds = useAoiStore((s) => s.setUnitIds);
  const selectedCategories = useAoiStore((s) => s.selectedCategories);
  const toggleCategory = useAoiStore((s) => s.toggleCategory);
  const toggleAllCategories = useAoiStore((s) => s.toggleAllCategories);
  const setPickingAoi = useAoiStore((s) => s.setPickingAoi);
  const busy = useAoiStore((s) => s.busy);
  const error = useAoiStore((s) => s.error);
  const preflight = useAoiStore((s) => s.preflight);
  const boundaryMessage = useAoiStore((s) => s.boundaryMessage);
  const progress = useAoiStore((s) => s.progress);
  const result = useAoiStore((s) => s.result);
  const applyAoi = useAoiStore((s) => s.applyAoi);

  useEffect(() => {
    void loadCatalog(onActivity);
  }, [loadCatalog, onActivity]);

  const unitsByKind = useMemo(() => {
    const list = catalog?.units ?? [];
    return {
      voivodeship: list.filter((u) => u.kind === "voivodeship"),
      county: list.filter((u) => u.kind === "county"),
      gmina: list.filter((u) => u.kind === "gmina"),
    };
  }, [catalog]);

  const selectedUnitCount = unitIds.length;
  const failedDomainCount = result ? result.outcomes.filter((outcome) => outcome.status === "failed").length : 0;
  const canPrepare = mode === "administrative_selection"
    ? unitIds.length > 0
    : isPointRadiusValid(longitude, latitude, radius);

  return (
    <section className="drawerContent drawerSection aoiSettings" aria-label="AOI & Profile Configuration">
      <div className="sectionHeading">
        <h2>AOI & cache</h2>
        <span>Poland / PRG</span>
      </div>
      <div className="defaultAoiCard">
        <div className="defaultAoiInfo">
          <strong>Default Snapshot: Rybnik (35 km)</strong>
          <p className="muted">All 11 infrastructure domains pre-generated and cached offline.</p>
        </div>
        <button
          type="button"
          disabled={busy || isDefaultAoiActive}
          className="secondaryButton"
          onClick={onResetToDefault}
        >
          {isDefaultAoiActive ? "Default snapshot active" : "Use default snapshot"}
        </button>
      </div>
      <hr className="drawerDivider" />
      <div className="sectionSubheading">
        <h3>Prepare Custom AOI</h3>
      </div>
      <p className="muted">Configure custom AOI boundaries and provider domains for acquisition.</p>
      <div className="modeButtons">
        <button
          type="button"
          disabled={busy}
          className={mode === "point_radius" ? "active" : ""}
          onClick={() => setMode("point_radius")}
        >
          Point + radius
        </button>
        <button
          type="button"
          disabled={busy}
          className={mode === "administrative_selection" ? "active" : ""}
          onClick={() => setMode("administrative_selection")}
        >
          Administrative PRG
        </button>
      </div>
      {mode === "point_radius" ? (
        <div className="aoiFields">
          <label>
            Latitude
            <input
              disabled={busy}
              placeholder="e.g. 50.102"
              value={latitude}
              onChange={(event) => setLatitude(event.target.value)}
              inputMode="decimal"
            />
          </label>
          <label>
            Longitude
            <input
              disabled={busy}
              placeholder="e.g. 18.546"
              value={longitude}
              onChange={(event) => setLongitude(event.target.value)}
              inputMode="decimal"
            />
          </label>
          <label>
            Radius (m)
            <input
              disabled={busy}
              placeholder="e.g. 20000"
              value={radius}
              onChange={(event) => setRadius(event.target.value)}
              inputMode="numeric"
            />
          </label>
          <button
            type="button"
            disabled={busy}
            className="secondaryButton"
            onClick={() => setPickingAoi(true)}
          >
            Pick point on map
          </button>
        </div>
      ) : (
        <AdministrativeTree
          disabled={busy}
          unitsByKind={unitsByKind}
          unitIds={unitIds}
          onChange={setUnitIds}
        />
      )}
      {boundaryMessage && <p className="muted boundaryMessage">{boundaryMessage}</p>}
      <p className="muted">
        Selected units: {selectedUnitCount}. Choose one province branch, then select its province, counties, gminas or an explicit union; preparation is blocked before Overpass if the real PRG geometry exceeds the provider limit.
      </p>
      <fieldset className="categorySelector">
        <legend>Provider domains</legend>
        <button
          type="button"
          disabled={busy}
          className="textButton"
          onClick={toggleAllCategories}
        >
          {selectedCategories.length === ALL_RUNTIME_CATEGORIES.length ? "Clear all" : "Select all"}
        </button>
        <div className="categoryGrid">
          {ALL_RUNTIME_CATEGORIES.map((category) => (
            <label className="layerToggle" key={category}>
              <input
                type="checkbox"
                disabled={busy}
                checked={selectedCategories.includes(category)}
                onChange={(event) => toggleCategory(category, event.target.checked)}
              />
              <span><strong>{category}</strong></span>
            </label>
          ))}
        </div>
      </fieldset>
      <button
        type="button"
        disabled={busy || selectedCategories.length === 0 || !canPrepare}
        onClick={() => void applyAoi(onActivity, onApplied)}
      >
        {busy ? "Preparing AOI…" : failedDomainCount ? "Retry failed domains" : "Prepare AOI"}
      </button>
      {progress && <RuntimeProgress job={progress} />}
      {result && <RuntimeOutcomeSummary result={result} />}
      {preflight && <p className={preflight.status === "blocked" ? "inlineError error" : "muted"}>{preflight.message}</p>}
      {error && <p className="inlineError error">{error}</p>}
    </section>
  );
}

function RuntimeOutcomeSummary({ result }: { result: ProviderRuntimeResponse }) {
  const failed = result.outcomes.filter((outcome) => outcome.status === "failed");
  if (!failed.length) return <p className="muted runtimeOutcomeSummary">All selected domains have a published provider outcome.</p>;
  return (
    <section className="runtimeOutcomeSummary partialSnapshot" aria-live="polite">
      <strong>Partial snapshot published</strong>
      <p>The completed domains are available on the map. Retry only the domains below; their completed neighbours will stay in this snapshot.</p>
      <ul>
        {failed.map((outcome) => (
          <li key={outcome.domain}>
            <strong>{outcome.domain}</strong>
            <span>{outcome.failure_reason === "timeout" ? "Timed out" : "Acquisition failed"}: {outcome.detail}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RuntimeProgress({ job }: { job: ProviderRuntimeJob }) {
  const percent = job.total_domains ? Math.round((job.completed_domains / job.total_domains) * 100) : 0;
  const active = runtimeProgressMessage(job);
  return (
    <section className="runtimeProgress" aria-live="polite">
      <div>
        <strong>{active}</strong>
        <span>{job.completed_domains} / {job.total_domains} domains</span>
      </div>
      <div className="runtimeProgressTrack" role="progressbar" aria-valuemin={0} aria-valuemax={job.total_domains} aria-valuenow={job.completed_domains}>
        <i style={{ width: `${percent}%` }} />
      </div>
      <p>{job.queried_feature_count.toLocaleString()} received · {job.accepted_feature_count.toLocaleString()} accepted</p>
    </section>
  );
}

function runtimeProgressMessage(job: ProviderRuntimeJob): string {
  switch (job.event) {
    case "queued": return "Waiting for worker…";
    case "cache_hit": return "Found a verified local snapshot…";
    case "started": return "Preparing the selected AOI…";
    case "domain_started": return job.active_domain ? `Preparing ${job.active_domain}…` : "Preparing a provider domain…";
    case "domain_completed": return job.active_domain ? `Preparing ${job.active_domain}…` : `Completed ${job.completed_domains} of ${job.total_domains} domains…`;
    case "published": return "Published the AOI snapshot.";
    case "failed": return "AOI preparation failed.";
  }
}

type AdministrativeBranch = { unit: AdministrativeUnit; counties: Array<{ unit: AdministrativeUnit; gminas: AdministrativeUnit[] }> };

function AdministrativeTree({
  unitsByKind,
  unitIds,
  disabled = false,
  onChange,
}: {
  unitsByKind: { voivodeship: AdministrativeUnit[]; county: AdministrativeUnit[]; gmina: AdministrativeUnit[] };
  unitIds: string[];
  disabled?: boolean;
  onChange: (value: string[]) => void;
}) {
  const [expandedVoivodeships, setExpandedVoivodeships] = useState<string[]>([]);
  const [expandedCounties, setExpandedCounties] = useState<string[]>([]);
  const branches = useMemo(() => buildAdministrativeBranches(unitsByKind), [unitsByKind]);
  const allUnits = useMemo(() => [...unitsByKind.voivodeship, ...unitsByKind.county, ...unitsByKind.gmina], [unitsByKind]);
  const selectedRoots = administrativeSelectionRoots(unitIds, allUnits);
  const activeRoot = selectedRoots.length === 1 ? selectedRoots[0] : null;
  const setExpanded = (id: string, open: boolean, setter: (update: (current: string[]) => string[]) => void) =>
    setter((current) => (open ? [...new Set([...current, id])] : current.filter((item) => item !== id)));
  const toggle = (
    branch: AdministrativeBranch,
    county: { unit: AdministrativeUnit; gminas: AdministrativeUnit[] } | null,
    gmina: AdministrativeUnit | null,
    checked: boolean,
  ) => {
    if (disabled || (checked && activeRoot && activeRoot !== branch.unit.id)) return;
    onChange(nextTreeSelection(unitIds, branch, county, gmina, checked));
  };
  return (
    <section className="aoiUnits administrativeTree" aria-label="Administrative PRG tree">
      <p className="muted">Expand one province branch to select a province, county or gmina. Selecting any item locks the tree to that one province.</p>
      {branches.map((branch) => {
        const rootDisabled = disabled || Boolean(activeRoot && activeRoot !== branch.unit.id);
        const rootSelected =
          unitIds.includes(branch.unit.id) ||
          branch.counties.every((county) => unitIds.includes(county.unit.id) || county.gminas.every((gmina) => unitIds.includes(gmina.id)));
        const rootMixed =
          !rootSelected &&
          branch.counties.some((county) => unitIds.includes(county.unit.id) || county.gminas.some((gmina) => unitIds.includes(gmina.id)));
        return (
          <details
            className="administrativeBranch"
            key={branch.unit.id}
            open={expandedVoivodeships.includes(branch.unit.id)}
            onToggle={(event) => setExpanded(branch.unit.id, (event.currentTarget as HTMLDetailsElement).open, setExpandedVoivodeships)}
          >
            <summary>
              <TreeToggle
                label={`Select ${branch.unit.name} voivodeship`}
                checked={rootSelected}
                mixed={rootMixed}
                disabled={rootDisabled}
                onChange={(checked) => toggle(branch, null, null, checked)}
              />
              <span>
                <strong>{branch.unit.name}</strong>
                <small>Voivodeship · PRG / TERYT {branch.unit.prg_id}</small>
              </span>
            </summary>
            {expandedVoivodeships.includes(branch.unit.id) && (
              <div className="treeChildren">
                {branch.counties.map((county) => {
                  const countyLeafIds = county.gminas.map((gmina) => gmina.id);
                  const countySelected =
                    rootSelected ||
                    unitIds.includes(county.unit.id) ||
                    countyLeafIds.every((id) => isTreeUnitSelected(unitIds, id, [branch.unit.id, county.unit.id]));
                  const countyMixed =
                    !countySelected && countyLeafIds.some((id) => isTreeUnitSelected(unitIds, id, [branch.unit.id, county.unit.id]));
                  return (
                    <details
                      className="administrativeBranch countyBranch"
                      key={county.unit.id}
                      open={expandedCounties.includes(county.unit.id)}
                      onToggle={(event) => setExpanded(county.unit.id, (event.currentTarget as HTMLDetailsElement).open, setExpandedCounties)}
                    >
                      <summary>
                        <TreeToggle
                          label={`Select ${county.unit.name} county`}
                          checked={countySelected}
                          mixed={countyMixed}
                          disabled={rootDisabled}
                          onChange={(checked) => toggle(branch, county, null, checked)}
                        />
                        <span>
                          <strong>{county.unit.name}</strong>
                          <small>County · PRG / TERYT {county.unit.prg_id}</small>
                        </span>
                      </summary>
                      {expandedCounties.includes(county.unit.id) && (
                        <div className="treeChildren gminaChildren">
                          {county.gminas.map((gmina) => (
                            <label className="treeLeaf" key={gmina.id}>
                              <input
                                className="treeCheck"
                                type="checkbox"
                                checked={rootSelected || countySelected || unitIds.includes(gmina.id)}
                                disabled={rootDisabled}
                                aria-label={`Select ${gmina.name} gmina`}
                                onChange={(event) => toggle(branch, county, gmina, event.target.checked)}
                              />
                              <span>
                                <strong>{gmina.name}</strong>
                                <small>Gmina · PRG / TERYT {gmina.prg_id}</small>
                              </span>
                            </label>
                          ))}
                        </div>
                      )}
                    </details>
                  );
                })}
              </div>
            )}
          </details>
        );
      })}
    </section>
  );
}

function buildAdministrativeBranches(unitsByKind: {
  voivodeship: AdministrativeUnit[];
  county: AdministrativeUnit[];
  gmina: AdministrativeUnit[];
}): AdministrativeBranch[] {
  const gminasByCounty = new Map<string, AdministrativeUnit[]>();
  unitsByKind.gmina.forEach((gmina) => gminasByCounty.set(gmina.parent_id ?? "", [...(gminasByCounty.get(gmina.parent_id ?? "") ?? []), gmina]));
  const countiesByVoivodeship = new Map<string, AdministrativeUnit[]>();
  unitsByKind.county.forEach((county) =>
    countiesByVoivodeship.set(county.parent_id ?? "", [...(countiesByVoivodeship.get(county.parent_id ?? "") ?? []), county]),
  );
  return [...unitsByKind.voivodeship]
    .sort((left, right) => left.name.localeCompare(right.name, "pl"))
    .map((unit) => ({
      unit,
      counties: (countiesByVoivodeship.get(unit.id) ?? [])
        .sort((left, right) => left.name.localeCompare(right.name, "pl"))
        .map((county) => ({
          unit: county,
          gminas: [...(gminasByCounty.get(county.id) ?? [])].sort((left, right) => left.name.localeCompare(right.name, "pl")),
        })),
    }));
}

function isTreeUnitSelected(unitIds: string[], unitId: string, ancestors: string[]): boolean {
  return unitIds.includes(unitId) || ancestors.some((ancestor) => unitIds.includes(ancestor));
}

function nextTreeSelection(
  current: string[],
  branch: AdministrativeBranch,
  county: { unit: AdministrativeUnit; gminas: AdministrativeUnit[] } | null,
  gmina: AdministrativeUnit | null,
  checked: boolean,
): string[] {
  const rootId = branch.unit.id;
  const rootLeaves = branch.counties.flatMap((item) => item.gminas.map((item) => item.id));
  const rootFullySelected =
    current.includes(rootId) ||
    branch.counties.every((item) => current.includes(item.unit.id) || item.gminas.every((gmina) => current.includes(gmina.id)));
  const countyLeaves = county?.gminas.map((item) => item.id) ?? [];
  if (checked) {
    if (!county) return [rootId];
    if (!gmina) return normalizedSelection(current.filter((id) => !countyLeaves.includes(id) && id !== county.unit.id && id !== rootId).concat(county.unit.id));
    return normalizedSelection(current.filter((id) => id !== gmina.id).concat(gmina.id));
  }
  if (!county) return normalizedSelection(current.filter((id) => id !== rootId && !rootLeaves.includes(id) && !branch.counties.some((item) => item.unit.id === id)));
  if (!gmina) {
    if (rootFullySelected) return normalizedSelection(rootLeaves.filter((id) => !countyLeaves.includes(id)));
    return normalizedSelection(current.filter((id) => id !== county.unit.id && !countyLeaves.includes(id)));
  }
  if (current.includes(rootId)) return normalizedSelection(rootLeaves.filter((id) => id !== gmina.id));
  if (current.includes(county.unit.id)) return normalizedSelection(current.filter((id) => id !== county.unit.id).concat(countyLeaves.filter((id) => id !== gmina.id)));
  return normalizedSelection(current.filter((id) => id !== gmina.id));
}

function normalizedSelection(unitIds: string[]): string[] {
  return [...new Set(unitIds)].sort();
}

function TreeToggle({
  label,
  checked,
  mixed,
  disabled,
  onChange,
}: {
  label: string;
  checked: boolean;
  mixed: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = mixed;
  }, [mixed]);
  return (
    <input
      className="treeCheck"
      ref={inputRef}
      type="checkbox"
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}
