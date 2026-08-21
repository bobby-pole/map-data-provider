import { useState } from "react";

import { getSourceProblemInfo, SOURCE_FRIENDLY_NAMES } from "../sourceAvailability";
import type { SourceAvailabilityReport } from "../types/api";

export function SourceAvailabilitySection({
  sourceAvailability,
}: {
  sourceAvailability: SourceAvailabilityReport | null;
}) {
  const [showAll, setShowAll] = useState(false);

  if (!sourceAvailability) {
    return (
      <section className="providerGroup">
        <details className="sourceAvailabilityDrawer">
          <summary className="sourceAvailabilitySummary">
            <span>Source availability</span>
            <span className="sourceBadge mutedBadge">No active AOI</span>
          </summary>
          <p className="muted" style={{ marginTop: "8px" }}>
            Prepare an AOI to inspect cached source availability and data lineage.
          </p>
        </details>
      </section>
    );
  }

  const evaluatedSources = sourceAvailability.sources.map((source) => ({
    source,
    problem: getSourceProblemInfo(source),
    displayName: SOURCE_FRIENDLY_NAMES[source.source_id] ?? source.source_id,
  }));

  const problemSources = evaluatedSources.filter((item) => item.problem.isProblem);
  const displayedSources = showAll ? evaluatedSources : problemSources;

  return (
    <section className="providerGroup">
      <details className="sourceAvailabilityDrawer">
        <summary className="sourceAvailabilitySummary">
          <span className="sourceAvailabilityTitle">Source availability</span>
          {problemSources.length > 0 ? (
            <span className="sourceBadge warningBadge">
              {problemSources.length} {problemSources.length === 1 ? "source gap" : "source gaps"}
            </span>
          ) : (
            <span className="sourceBadge successBadge">All sources healthy</span>
          )}
        </summary>

        <div className="sourceAvailabilityContent">
          {problemSources.length === 0 && !showAll ? (
            <div className="sourceHealthyNotice">
              <span className="sourceHealthyIcon">✓</span>
              <div>
                <strong>All registered data sources are healthy.</strong>
                <p className="muted">
                  OpenStreetMap, PRG, KIUT, Orthophoto, and Terrain contexts are available and
                  covered for this AOI.
                </p>
              </div>
            </div>
          ) : (
            <div className="sourceProblemList">
              <p className="sourceSubheader">
                {showAll
                  ? `Showing all ${evaluatedSources.length} registered sources:`
                  : `Showing ${problemSources.length} sources with gaps or limitations:`}
              </p>
              {displayedSources.map(({ source, problem, displayName }) => (
                <div
                  key={source.source_id}
                  className={`sourceProblemCard ${problem.isProblem ? `severity-${problem.severity}` : "severity-healthy"}`}
                >
                  <div className="sourceCardHeader">
                    <strong>{displayName}</strong>
                    <span className={`sourceCardTag tag-${problem.severity}`}>{problem.title}</span>
                  </div>
                  <p className="sourceCardExplanation">{problem.explanation}</p>
                  <div className="sourceCardFooter">
                    <span className="sourceCardId">ID: {source.source_id}</span>
                    {source.evidence && (
                      <span className="sourceCardEvidence">· {source.evidence}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="sourceAvailabilityActions">
            <button
              type="button"
              className="textButton"
              onClick={() => setShowAll((current) => !current)}
            >
              {showAll
                ? "Show only gaps & issues"
                : `Show all ${evaluatedSources.length} registered sources`}
            </button>
          </div>
        </div>
      </details>
    </section>
  );
}
