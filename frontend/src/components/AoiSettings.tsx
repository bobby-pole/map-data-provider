import { useEffect, useMemo, useRef, useState } from "react";

import {
  administrativeSelectionRoots,
  MAX_CUSTOM_RADIUS_M,
  MAX_DEMO_RADIUS_M,
  parseCoordinate,
  validateAdministrativeUnitSelection,
  validatePointRadiusInput,
} from "../aoiSettings";
import { ALL_RUNTIME_CATEGORIES, useAoiStore } from "../stores/aoiStore";
import type { AdministrativeUnit, ProviderRuntimeJob, ProviderRuntimeResponse } from "../types/api";
import type { ActivityEvent } from "./ActivityWindow";
import { RuntimeAcquisitionEvidencePanel } from "./RuntimeAcquisitionEvidencePanel";

type Props = {
  onActivity: (event: Omit<ActivityEvent, "id" | "timestamp">) => void;
  onApplied: (result: ProviderRuntimeResponse) => void;
  onResetToDefault?: () => void;
  isDefaultAoiActive?: boolean;
  isDefaultAoiHidden?: boolean;
  onToggleDefaultAoiHidden?: () => void;
};

export function AoiSettings({
  onActivity,
  onApplied,
  onResetToDefault,
  isDefaultAoiActive = true,
  isDefaultAoiHidden = false,
  onToggleDefaultAoiHidden,
}: Props) {
  const catalog = useAoiStore((s) => s.catalog);
  const loadCatalog = useAoiStore((s) => s.loadCatalog);
  const runtimeCapability = useAoiStore((s) => s.runtimeCapability);
  const loadRuntimeCapability = useAoiStore((s) => s.loadRuntimeCapability);
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

  const [latBubble, setLatBubble] = useState<string | null>(null);
  const latTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [lonBubble, setLonBubble] = useState<string | null>(null);
  const lonTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [radiusBubble, setRadiusBubble] = useState<string | null>(null);
  const radiusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [lastClickedUnitId, setLastClickedUnitId] = useState<string | null>(null);
  const [treeBubble, setTreeBubble] = useState<{ unitId: string; message: string } | null>(null);
  const treeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [prepareBubble, setPrepareBubble] = useState<string | null>(null);
  const prepareTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showTreeError = (unitId: string, message: string) => {
    if (treeTimerRef.current) {
      clearTimeout(treeTimerRef.current);
    }
    setTreeBubble({ unitId, message });
    treeTimerRef.current = setTimeout(() => {
      setTreeBubble(null);
    }, 3500);
  };

  useEffect(() => {
    void loadRuntimeCapability();
  }, [loadRuntimeCapability]);

  useEffect(() => {
    if (runtimeCapability?.supports_custom_aoi) {
      void loadCatalog(onActivity);
    }
  }, [loadCatalog, onActivity, runtimeCapability?.supports_custom_aoi]);

  useEffect(() => {
    if (!error && (!preflight || preflight.status !== "blocked")) {
      return;
    }
    const timer = setTimeout(() => {
      useAoiStore.setState({ error: null });
    }, 3500);
    return () => clearTimeout(timer);
  }, [error, preflight]);

  const activeStoreError = error || (preflight?.status === "blocked" ? preflight.message : null);

  const effectiveTreeBubble =
    treeBubble ||
    (mode === "administrative_selection" && lastClickedUnitId && activeStoreError
      ? { unitId: lastClickedUnitId, message: activeStoreError }
      : null);

  const effectivePrepareBubble =
    prepareBubble ||
    (!lastClickedUnitId || mode !== "administrative_selection" ? activeStoreError : null);

  const unitsByKind = useMemo(() => {
    const list = catalog?.units ?? [];
    return {
      voivodeship: list.filter((u) => u.kind === "voivodeship"),
      county: list.filter((u) => u.kind === "county"),
      gmina: list.filter((u) => u.kind === "gmina"),
    };
  }, [catalog]);

  const allUnits = useMemo(() => catalog?.units ?? [], [catalog]);
  const demoMode = runtimeCapability?.mode === "demo_fixed_aoi";
  const maxRadiusM = demoMode ? MAX_DEMO_RADIUS_M : MAX_CUSTOM_RADIUS_M;
  useEffect(() => {
    if (demoMode && selectedCategories.length !== ALL_RUNTIME_CATEGORIES.length) {
      useAoiStore.setState({ selectedCategories: [...ALL_RUNTIME_CATEGORIES] });
    }
  }, [demoMode, selectedCategories.length]);
  useEffect(() => {
    const currentRadius = parseCoordinate(radius);
    if (Number.isFinite(currentRadius) && currentRadius > maxRadiusM) {
      setRadius(String(maxRadiusM));
    }
  }, [maxRadiusM, radius, setRadius]);
  const validation = useMemo(() => {
    if (mode === "administrative_selection") {
      return validateAdministrativeUnitSelection(unitIds, allUnits, demoMode ? 1 : 3);
    }
    return validatePointRadiusInput(longitude, latitude, radius, maxRadiusM);
  }, [mode, unitIds, allUnits, longitude, latitude, radius, maxRadiusM, demoMode]);

  const parsedLat = parseCoordinate(latitude);
  const isLatitudeInvalid =
    latitude.trim().length > 0 &&
    (!Number.isFinite(parsedLat) || parsedLat < -90 || parsedLat > 90);

  const onLatitudeChange = (val: string) => {
    setLatitude(val);
    const parsed = parseCoordinate(val);
    if (latTimerRef.current) {
      clearTimeout(latTimerRef.current);
    }

    if (val.trim().length > 0 && (!Number.isFinite(parsed) || parsed < -90 || parsed > 90)) {
      setLatBubble("Enter a valid latitude between -90 and 90 (e.g. 50.102).");
      latTimerRef.current = setTimeout(() => {
        setLatBubble(null);
      }, 3500);
    } else {
      setLatBubble(null);
    }
  };

  const parsedLon = parseCoordinate(longitude);
  const isLongitudeInvalid =
    longitude.trim().length > 0 &&
    (!Number.isFinite(parsedLon) || parsedLon < -180 || parsedLon > 180);

  const onLongitudeChange = (val: string) => {
    setLongitude(val);
    const parsed = parseCoordinate(val);
    if (lonTimerRef.current) {
      clearTimeout(lonTimerRef.current);
    }

    if (val.trim().length > 0 && (!Number.isFinite(parsed) || parsed < -180 || parsed > 180)) {
      setLonBubble("Enter a valid longitude between -180 and 180 (e.g. 18.546).");
      lonTimerRef.current = setTimeout(() => {
        setLonBubble(null);
      }, 3500);
    } else {
      setLonBubble(null);
    }
  };

  const parsedRadius = parseCoordinate(radius);
  const isRadiusTooLarge = Number.isFinite(parsedRadius) && parsedRadius > maxRadiusM;
  const isRadiusInvalid =
    radius.trim().length > 0 && (!Number.isFinite(parsedRadius) || parsedRadius <= 0);

  const onRadiusChange = (val: string) => {
    setRadius(val);
    const parsed = parseCoordinate(val);
    if (radiusTimerRef.current) {
      clearTimeout(radiusTimerRef.current);
    }

    if (val.trim().length > 0 && Number.isFinite(parsed) && parsed > maxRadiusM) {
      setRadiusBubble(`Radius exceeds maximum allowed limit of ${maxRadiusM / 1000} km.`);
      radiusTimerRef.current = setTimeout(() => {
        setRadiusBubble(null);
      }, 3500);
    } else if (val.trim().length > 0 && (!Number.isFinite(parsed) || parsed <= 0)) {
      setRadiusBubble("Enter a valid positive radius in meters.");
      radiusTimerRef.current = setTimeout(() => {
        setRadiusBubble(null);
      }, 3500);
    } else {
      setRadiusBubble(null);
    }
  };

  const selectedUnitCount = unitIds.length;
  const failedDomainCount = result
    ? result.outcomes.filter((outcome) => outcome.status === "failed").length
    : 0;
  const canPrepare = validation.valid;

  const handleApply = async () => {
    if (!validation.valid && validation.error) {
      if (mode === "administrative_selection" && lastClickedUnitId) {
        showTreeError(lastClickedUnitId, validation.error);
      } else {
        setPrepareBubble(validation.error);
        if (prepareTimerRef.current) {
          clearTimeout(prepareTimerRef.current);
        }
        prepareTimerRef.current = setTimeout(() => {
          setPrepareBubble(null);
        }, 3500);
      }
      return;
    }
    await applyAoi(onActivity, onApplied);
  };

  if (runtimeCapability?.mode === "disabled") {
    return (
      <section
        className="drawerContent drawerSection aoiSettings"
        aria-label="AOI & Profile Configuration"
      >
        <div className="sectionHeading">
          <h2>AOI & cache</h2>
          <span>read-only</span>
        </div>
        <div className="runtimeModeNotice">
          <h3>Custom acquisition is unavailable</h3>
          <p>
            This deployment serves verified prepared snapshots only. Start the local bounded runtime
            to prepare a new AOI.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section
      className="drawerContent drawerSection aoiSettings"
      aria-label="AOI & Profile Configuration"
    >
      <div className="sectionHeading">
        <h2>AOI & cache</h2>
        <span>{demoMode ? "public demo" : "Poland / PRG"}</span>
      </div>
      <div className="defaultAoiCard">
        <div className="defaultAoiInfo">
          <strong>Default Snapshot: Rybnik (35 km)</strong>
          <p className="muted">All 11 infrastructure domains pre-generated and cached offline.</p>
        </div>
        <div className="defaultAoiActions">
          <button
            type="button"
            disabled={busy || (isDefaultAoiActive && !isDefaultAoiHidden)}
            className="secondaryButton"
            onClick={() => {
              if (isDefaultAoiHidden && onToggleDefaultAoiHidden) {
                onToggleDefaultAoiHidden();
              }
              onResetToDefault?.();
            }}
          >
            {isDefaultAoiActive && !isDefaultAoiHidden ? "Default active" : "Load default"}
          </button>
          <button
            type="button"
            disabled={busy || !isDefaultAoiActive}
            className="secondaryButton"
            onClick={onToggleDefaultAoiHidden}
          >
            {isDefaultAoiHidden ? "Show objects" : "Hide objects"}
          </button>
        </div>
      </div>
      <hr className="drawerDivider" />
      {demoMode ? (
        <div className="runtimeModeNotice">
          <h3>Controlled demo acquisition</h3>
          <p>
            Choose a point inside Poland (maximum 10 km radius) or one PRG county. The server
            prepares all 11 domains and generates a PMTiles presentation so the map can switch to
            the new AOI.
          </p>
        </div>
      ) : null}
      <div className="sectionSubheading">
        <h3>{demoMode ? "Prepare demo AOI" : "Prepare Custom AOI"}</h3>
      </div>
      <div className="aoiRulesBanner">
        <strong>AOI Selection Rules & Limits:</strong>
        <ul>
          <li>
            <strong>Point on map:</strong> maximum radius of <strong>{maxRadiusM / 1000} km</strong>
            .
          </li>
          <li>
            <strong>Voivodeships:</strong> selecting an entire voivodeship is{" "}
            <strong>blocked</strong> (expand to select counties/gminas).
          </li>
          <li>
            <strong>Counties:</strong> up to <strong>{demoMode ? "1" : "3"}</strong>{" "}
            {demoMode ? "county" : "directly adjacent counties"} in the same voivodeship.
          </li>
          <li>
            <strong>Gminas:</strong>{" "}
            {demoMode
              ? "gminas within the selected county only"
              : "any number of gminas across up to 3 adjacent counties"}
            .
          </li>
        </ul>
      </div>
      <div className="modeButtons">
        <button
          type="button"
          disabled={busy}
          className={mode === "point_radius" ? "active" : ""}
          onClick={() => setMode("point_radius")}
        >
          Point + radius (max {maxRadiusM / 1000} km)
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
          <label className="contextualAnchor">
            {latBubble && (
              <div className="contextualBubble" role="alert">
                <span>⚠️</span>
                <span>{latBubble}</span>
              </div>
            )}
            <span>Latitude</span>
            <input
              disabled={busy}
              placeholder="e.g. 50.102"
              value={latitude}
              onChange={(event) => onLatitudeChange(event.target.value)}
              inputMode="decimal"
              className={isLatitudeInvalid ? "inputError" : undefined}
            />
          </label>
          <label className="contextualAnchor">
            {lonBubble && (
              <div className="contextualBubble" role="alert">
                <span>⚠️</span>
                <span>{lonBubble}</span>
              </div>
            )}
            <span>Longitude</span>
            <input
              disabled={busy}
              placeholder="e.g. 18.546"
              value={longitude}
              onChange={(event) => onLongitudeChange(event.target.value)}
              inputMode="decimal"
              className={isLongitudeInvalid ? "inputError" : undefined}
            />
          </label>
          <label className="contextualAnchor radiusField">
            {radiusBubble && (
              <div className="contextualBubble" role="alert">
                <span>⚠️</span>
                <span>{radiusBubble}</span>
              </div>
            )}
            <span>
              Radius (m) — max {maxRadiusM.toLocaleString()} m ({maxRadiusM / 1000} km)
            </span>
            <input
              disabled={busy}
              placeholder={`e.g. ${maxRadiusM}`}
              value={radius}
              onChange={(event) => onRadiusChange(event.target.value)}
              inputMode="numeric"
              className={isRadiusTooLarge || isRadiusInvalid ? "inputError" : undefined}
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
          maxCounties={demoMode ? 1 : 3}
          unitsByKind={unitsByKind}
          unitIds={unitIds}
          treeBubble={effectiveTreeBubble}
          onShowTreeError={showTreeError}
          onSelectUnit={setLastClickedUnitId}
          onChange={setUnitIds}
        />
      )}
      {boundaryMessage && <p className="muted boundaryMessage">{boundaryMessage}</p>}
      <p className="muted">
        Selected units: {selectedUnitCount}.{" "}
        {demoMode
          ? "Select one county or its gminas."
          : "Choose up to 3 adjacent counties or their gminas within one voivodeship."}
      </p>
      <fieldset className="categorySelector">
        <legend>Provider domains</legend>
        <button
          type="button"
          disabled={busy || demoMode}
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
                disabled={busy || demoMode}
                checked={selectedCategories.includes(category)}
                onChange={(event) => toggleCategory(category, event.target.checked)}
              />
              <span>
                <strong>{category}</strong>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="contextualAnchor prepareAoiAnchor">
        {effectivePrepareBubble && (
          <div className="contextualBubble" role="alert">
            <span>⚠️</span>
            <span>{effectivePrepareBubble}</span>
          </div>
        )}
        <button
          type="button"
          className="prepareAoiButton"
          disabled={busy || selectedCategories.length === 0 || !canPrepare}
          onClick={() => void handleApply()}
        >
          {busy
            ? "Preparing AOI…"
            : failedDomainCount
              ? "Retry failed domains"
              : demoMode
                ? "Prepare selected demo AOI"
                : "Prepare AOI"}
        </button>
      </div>
      {progress && <RuntimeProgress job={progress} />}
      {result && <RuntimeOutcomeSummary result={result} />}
      <RuntimeAcquisitionEvidencePanel aoiId={result?.aoi.aoi_id ?? null} />
    </section>
  );
}

function RuntimeOutcomeSummary({ result }: { result: ProviderRuntimeResponse }) {
  const failed = result.outcomes.filter((outcome) => outcome.status === "failed");
  if (!failed.length) {
    return (
      <p className="muted runtimeOutcomeSummary">
        All selected domains have a published provider outcome.
      </p>
    );
  }
  return (
    <section className="runtimeOutcomeSummary partialSnapshot" aria-live="polite">
      <strong>Partial snapshot published</strong>
      <p>
        The completed domains are available on the map. Retry only the domains below; their
        completed neighbours will stay in this snapshot.
      </p>
      <ul>
        {failed.map((outcome) => (
          <li key={outcome.domain}>
            <strong>{outcome.domain}</strong>
            <span>
              {outcome.failure_reason === "timeout" ? "Timed out" : "Acquisition failed"}:{" "}
              {outcome.detail}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RuntimeProgress({ job }: { job: ProviderRuntimeJob }) {
  const percent = job.total_domains
    ? Math.round((job.completed_domains / job.total_domains) * 100)
    : 0;
  const active = runtimeProgressMessage(job);
  return (
    <section className="runtimeProgress" aria-live="polite">
      <div>
        <strong>{active}</strong>
        <span>
          {job.completed_domains} / {job.total_domains} domains
        </span>
      </div>
      <div
        className="runtimeProgressTrack"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={job.total_domains}
        aria-valuenow={job.completed_domains}
      >
        <i style={{ width: `${percent}%` }} />
      </div>
      <p>
        {job.queried_feature_count.toLocaleString()} received ·{" "}
        {job.accepted_feature_count.toLocaleString()} accepted
      </p>
    </section>
  );
}

function runtimeProgressMessage(job: ProviderRuntimeJob): string {
  switch (job.event) {
    case "queued":
      return "Waiting for worker…";
    case "cache_hit":
      return "Found a verified local snapshot…";
    case "started":
      return "Preparing the selected AOI…";
    case "domain_started":
      return job.active_domain ? `Preparing ${job.active_domain}…` : "Preparing a provider domain…";
    case "domain_completed":
      return job.active_domain
        ? `Preparing ${job.active_domain}…`
        : `Completed ${job.completed_domains} of ${job.total_domains} domains…`;
    case "published":
      return "Published the AOI snapshot.";
    case "failed":
      return "AOI preparation failed.";
  }
}

type AdministrativeBranch = {
  unit: AdministrativeUnit;
  counties: Array<{ unit: AdministrativeUnit; gminas: AdministrativeUnit[] }>;
};

function AdministrativeTree({
  unitsByKind,
  unitIds,
  maxCounties = 3,
  disabled = false,
  treeBubble,
  onShowTreeError,
  onSelectUnit,
  onChange,
}: {
  unitsByKind: {
    voivodeship: AdministrativeUnit[];
    county: AdministrativeUnit[];
    gmina: AdministrativeUnit[];
  };
  unitIds: string[];
  maxCounties?: number;
  disabled?: boolean;
  treeBubble?: { unitId: string; message: string } | null;
  onShowTreeError: (unitId: string, message: string) => void;
  onSelectUnit: (unitId: string) => void;
  onChange: (value: string[]) => void;
}) {
  const [expandedVoivodeships, setExpandedVoivodeships] = useState<string[]>([]);
  const [expandedCounties, setExpandedCounties] = useState<string[]>([]);
  const branches = useMemo(() => buildAdministrativeBranches(unitsByKind), [unitsByKind]);
  const allUnits = useMemo(
    () => [...unitsByKind.voivodeship, ...unitsByKind.county, ...unitsByKind.gmina],
    [unitsByKind],
  );
  const byId = useMemo(() => new Map(allUnits.map((u) => [u.id, u])), [allUnits]);

  const selectedRoots = administrativeSelectionRoots(unitIds, allUnits);
  const activeRoot = selectedRoots.length === 1 ? selectedRoots[0] : null;

  const involvedCounties = useMemo(() => {
    const set = new Set<string>();
    for (const id of unitIds) {
      const u = byId.get(id);
      if (!u) {
        continue;
      }
      if (u.kind === "county") {
        set.add(id);
      } else if (u.kind === "gmina" && u.parent_id) {
        set.add(u.parent_id);
      }
    }
    return set;
  }, [unitIds, byId]);

  const setExpanded = (
    id: string,
    open: boolean,
    setter: (update: (current: string[]) => string[]) => void,
  ) =>
    setter((current) =>
      open ? [...new Set([...current, id])] : current.filter((item) => item !== id),
    );

  const toggle = (
    branch: AdministrativeBranch,
    county: { unit: AdministrativeUnit; gminas: AdministrativeUnit[] } | null,
    gmina: AdministrativeUnit | null,
    checked: boolean,
  ) => {
    if (disabled) {
      return;
    }
    const targetId = gmina ? gmina.id : county ? county.unit.id : branch.unit.id;
    onSelectUnit(targetId);
    onChange(nextTreeSelection(unitIds, allUnits, branch, county, gmina, checked));
  };

  return (
    <section className="aoiUnits administrativeTree" aria-label="Administrative PRG tree">
      <p className="muted">
        Expand a voivodeship branch to select up to {maxCounties}{" "}
        {maxCounties === 1 ? "county or its gminas." : "adjacent counties or their gminas."}
      </p>
      {branches.map((branch) => {
        const rootDisabled = disabled || Boolean(activeRoot && activeRoot !== branch.unit.id);
        return (
          <details
            className="administrativeBranch"
            key={branch.unit.id}
            open={expandedVoivodeships.includes(branch.unit.id)}
            onToggle={(event) =>
              setExpanded(branch.unit.id, event.currentTarget.open, setExpandedVoivodeships)
            }
          >
            <summary>
              <span>
                <strong>{branch.unit.name}</strong>
                <small>Voivodeship · PRG / TERYT {branch.unit.prg_id} (expand branch)</small>
              </span>
            </summary>
            {expandedVoivodeships.includes(branch.unit.id) && (
              <div className="treeChildren">
                {branch.counties.map((county) => {
                  const countyLeafIds = county.gminas.map((gmina) => gmina.id);
                  const countySelected =
                    unitIds.includes(county.unit.id) ||
                    (countyLeafIds.length > 0 && countyLeafIds.every((id) => unitIds.includes(id)));
                  const countyMixed =
                    !countySelected && countyLeafIds.some((id) => unitIds.includes(id));

                  const canSelectCounty =
                    !rootDisabled &&
                    (involvedCounties.size < maxCounties || involvedCounties.has(county.unit.id));
                  const countyToggleDisabled = disabled || !canSelectCounty;

                  const handleCountyClick = (e: React.MouseEvent) => {
                    onSelectUnit(county.unit.id);
                    if (countyToggleDisabled && !countySelected) {
                      e.preventDefault();
                      e.stopPropagation();
                      if (rootDisabled) {
                        onShowTreeError(
                          county.unit.id,
                          "All selected units must belong to the same voivodeship.",
                        );
                      } else {
                        onShowTreeError(
                          county.unit.id,
                          `Maximum ${maxCounties} ${maxCounties === 1 ? "county" : "adjacent counties"} can be selected.`,
                        );
                      }
                    }
                  };

                  return (
                    <details
                      className="administrativeBranch countyBranch"
                      key={county.unit.id}
                      open={expandedCounties.includes(county.unit.id)}
                      onToggle={(event) =>
                        setExpanded(county.unit.id, event.currentTarget.open, setExpandedCounties)
                      }
                    >
                      <summary className="contextualAnchor" onClick={handleCountyClick}>
                        {treeBubble?.unitId === county.unit.id && (
                          <div className="contextualBubble" role="alert">
                            <span>⚠️</span>
                            <span>{treeBubble.message}</span>
                          </div>
                        )}
                        <TreeToggle
                          label={`Select ${county.unit.name} county`}
                          checked={countySelected}
                          mixed={countyMixed}
                          disabled={countyToggleDisabled}
                          onChange={(checked) => toggle(branch, county, null, checked)}
                          onClick={handleCountyClick}
                        />
                        <span>
                          <strong>{county.unit.name}</strong>
                          <small>County · PRG / TERYT {county.unit.prg_id}</small>
                        </span>
                      </summary>
                      {expandedCounties.includes(county.unit.id) && (
                        <div className="treeChildren gminaChildren">
                          {county.gminas.map((gmina) => {
                            const isGminaDirectlySelected = unitIds.includes(gmina.id);
                            const isGminaSelected = countySelected || isGminaDirectlySelected;
                            const canSelectGmina =
                              !rootDisabled &&
                              (involvedCounties.size < maxCounties ||
                                involvedCounties.has(county.unit.id));
                            const gminaDisabled = disabled || (!isGminaSelected && !canSelectGmina);

                            const handleGminaClick = (e: React.MouseEvent) => {
                              onSelectUnit(gmina.id);
                              if (gminaDisabled && !isGminaSelected) {
                                e.preventDefault();
                                e.stopPropagation();
                                if (rootDisabled) {
                                  onShowTreeError(
                                    gmina.id,
                                    "All selected units must belong to the same voivodeship.",
                                  );
                                } else {
                                  onShowTreeError(
                                    gmina.id,
                                    `You can select units from at most ${maxCounties} ${maxCounties === 1 ? "county" : "adjacent counties"}.`,
                                  );
                                }
                              }
                            };

                            return (
                              <label
                                className="treeLeaf contextualAnchor"
                                key={gmina.id}
                                onClick={handleGminaClick}
                              >
                                {treeBubble?.unitId === gmina.id && (
                                  <div className="contextualBubble" role="alert">
                                    <span>⚠️</span>
                                    <span>{treeBubble.message}</span>
                                  </div>
                                )}
                                <input
                                  className="treeCheck"
                                  type="checkbox"
                                  checked={isGminaSelected}
                                  disabled={gminaDisabled}
                                  aria-label={`Select ${gmina.name} gmina`}
                                  onChange={(event) =>
                                    toggle(branch, county, gmina, event.target.checked)
                                  }
                                  onClick={handleGminaClick}
                                />
                                <span>
                                  <strong>{gmina.name}</strong>
                                  <small>Gmina · PRG / TERYT {gmina.prg_id}</small>
                                </span>
                              </label>
                            );
                          })}
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
  unitsByKind.gmina.forEach((gmina) =>
    gminasByCounty.set(gmina.parent_id ?? "", [
      ...(gminasByCounty.get(gmina.parent_id ?? "") ?? []),
      gmina,
    ]),
  );
  const countiesByVoivodeship = new Map<string, AdministrativeUnit[]>();
  unitsByKind.county.forEach((county) =>
    countiesByVoivodeship.set(county.parent_id ?? "", [
      ...(countiesByVoivodeship.get(county.parent_id ?? "") ?? []),
      county,
    ]),
  );
  return [...unitsByKind.voivodeship]
    .sort((left, right) => left.name.localeCompare(right.name, "pl"))
    .map((unit) => ({
      unit,
      counties: (countiesByVoivodeship.get(unit.id) ?? [])
        .sort((left, right) => left.name.localeCompare(right.name, "pl"))
        .map((county) => ({
          unit: county,
          gminas: [...(gminasByCounty.get(county.id) ?? [])].sort((left, right) =>
            left.name.localeCompare(right.name, "pl"),
          ),
        })),
    }));
}

function nextTreeSelection(
  current: string[],
  allUnits: AdministrativeUnit[],
  branch: AdministrativeBranch,
  county: { unit: AdministrativeUnit; gminas: AdministrativeUnit[] } | null,
  gmina: AdministrativeUnit | null,
  checked: boolean,
): string[] {
  const byId = new Map(allUnits.map((u) => [u.id, u]));
  const countyLeaves = county?.gminas.map((item) => item.id) ?? [];

  const currentRoots = administrativeSelectionRoots(current, allUnits);
  const isDifferentRoot = currentRoots.length > 0 && !currentRoots.includes(branch.unit.id);
  const base = isDifferentRoot ? [] : current;

  const involvedCounties = new Set<string>();
  for (const id of base) {
    const u = byId.get(id);
    if (!u) {
      continue;
    }
    if (u.kind === "county") {
      involvedCounties.add(id);
    } else if (u.kind === "gmina" && u.parent_id) {
      involvedCounties.add(u.parent_id);
    }
  }

  if (checked) {
    if (!county) {
      return current; // Voivodeship selection blocked
    }
    if (!gmina) {
      if (!involvedCounties.has(county.unit.id) && involvedCounties.size >= 3) {
        return current;
      }
      const filtered = base.filter((id) => id !== county.unit.id && !countyLeaves.includes(id));
      return normalizedSelection([...filtered, county.unit.id]);
    }
    if (!involvedCounties.has(county.unit.id) && involvedCounties.size >= 3) {
      return current;
    }
    if (base.includes(county.unit.id)) {
      return base;
    }
    return normalizedSelection([...base, gmina.id]);
  }

  // Unchecked
  if (!county) {
    return current;
  }
  if (!gmina) {
    return normalizedSelection(
      current.filter((id) => id !== county.unit.id && !countyLeaves.includes(id)),
    );
  }
  if (current.includes(county.unit.id)) {
    return normalizedSelection(
      current
        .filter((id) => id !== county.unit.id)
        .concat(countyLeaves.filter((id) => id !== gmina.id)),
    );
  }
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
  onClick,
}: {
  label: string;
  checked: boolean;
  mixed: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
  onClick?: (event: React.MouseEvent) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = mixed;
    }
  }, [mixed]);
  return (
    <input
      className="treeCheck"
      ref={inputRef}
      type="checkbox"
      aria-label={label}
      checked={checked}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.(event);
      }}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
}
