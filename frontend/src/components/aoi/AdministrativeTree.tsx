import { useEffect, useMemo, useRef, useState } from "react";

import { administrativeSelectionRoots } from "../../aoiSettings";
import type { AdministrativeUnit } from "../../types/api";
import {
  type AdministrativeBranch,
  buildAdministrativeBranches,
  nextTreeSelection,
} from "./treeSelection";

export function AdministrativeTree({
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
