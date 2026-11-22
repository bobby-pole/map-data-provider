import { type MutableRefObject, useEffect, useState } from "react";

import type { PowerPopupState, RelatedLine } from "../../components/map/constants";
import type { SelectedProviderFeature } from "../../inspection";
import type {
  MapCircuit,
  MapCircuitDetail,
  MapCircuitList,
  MapCircuitMember,
  MapFeatureDetail,
} from "../../types/api";

export function usePowerCircuitPopup({
  aoiId,
  selected,
  selectedCircuitMember,
  onCircuitChangeRef,
}: {
  aoiId?: string;
  selected: SelectedProviderFeature | null;
  selectedCircuitMember: MapCircuitMember | null;
  onCircuitChangeRef: MutableRefObject<(circuit: MapCircuit | null) => void>;
}): {
  powerPopup: PowerPopupState | null;
  selectedLineDetail: MapFeatureDetail | null;
  unavailableLineDetailForSourceId: string | null;
} {
  const [powerPopup, setPowerPopup] = useState<PowerPopupState | null>(null);
  const [selectedLineDetail, setSelectedLineDetail] = useState<MapFeatureDetail | null>(null);
  const [unavailableLineDetailForSourceId, setUnavailableLineDetailForSourceId] = useState<
    string | null
  >(null);

  useEffect(() => {
    const sourceId = selected?.feature.properties.source_id;
    if (!aoiId || selected?.layer.domain !== "power" || typeof sourceId !== "string") {
      return;
    }
    let cancelled = false;
    void fetch(
      `/api/aoi/${encodeURIComponent(aoiId)}/presentations/power/features/${encodeURIComponent(sourceId)}/circuits`,
    )
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Circuit list: HTTP ${response.status}`);
        }
        return response.json() as Promise<MapCircuitList>;
      })
      .then(async (list) => {
        if (list.state === "unavailable") {
          return {
            state: "unavailable" as const,
            lines: [] as RelatedLine[],
            detail: list.limitations?.[1] ?? list.limitations?.[0],
          };
        }
        if (list.state !== "available") {
          return { state: "empty" as const, lines: [] as RelatedLine[] };
        }
        const details = await Promise.all(
          list.circuits.map(async (summary) => {
            const response = await fetch(
              `/api/aoi/${encodeURIComponent(aoiId)}/presentations/power/circuits/${encodeURIComponent(summary.relation_id)}`,
            );
            if (!response.ok) {
              throw new Error(`Circuit details: HTTP ${response.status}`);
            }
            return response.json() as Promise<MapCircuitDetail>;
          }),
        );
        const lines = new Map<string, RelatedLine>();
        details.forEach(({ circuit }) =>
          circuit.members
            .filter((member) => member.geometry)
            .forEach((member) => lines.set(member.source_id, { circuit, member })),
        );
        return {
          state: lines.size ? ("available" as const) : ("empty" as const),
          lines: [...lines.values()],
        };
      })
      .then((result) => {
        if (cancelled) {
          return;
        }
        setPowerPopup({ sourceId, ...result });
        const directlySelectedLine = result.lines.find(
          (line) => line.member.source_id === sourceId,
        );
        if (directlySelectedLine) {
          onCircuitChangeRef.current(directlySelectedLine.circuit);
          // Don't auto-select individual member – show full circuit highlight
          // so all member ways are highlighted at once (like OpenInfraMap).
          // The user can still drill into a single member via the popup buttons.
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPowerPopup({
            sourceId,
            state: "unavailable",
            lines: [],
            detail: "Circuit evidence could not be recovered for this source feature.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [aoiId, selected, onCircuitChangeRef]);

  useEffect(() => {
    const sourceId = selectedCircuitMember?.source_id;
    if (!aoiId || !sourceId) {
      return;
    }
    let cancelled = false;
    void fetch(
      `/api/aoi/${encodeURIComponent(aoiId)}/presentations/power/features/${encodeURIComponent(sourceId)}`,
    )
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Line details: HTTP ${response.status}`);
        }
        return response.json() as Promise<MapFeatureDetail>;
      })
      .then((detail) => {
        if (!cancelled) {
          setSelectedLineDetail(detail);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setUnavailableLineDetailForSourceId(sourceId);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [aoiId, selectedCircuitMember]);

  return { powerPopup, selectedLineDetail, unavailableLineDetailForSourceId };
}
