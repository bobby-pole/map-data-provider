import { useMemo, useState } from "react";
import { MapView } from "./components/MapView";
import { useDataQuality } from "./hooks/useApi";
import type { DataQualityIssue } from "./types/api";
import "./index.css";

function severityClass(severity: DataQualityIssue["severity"]) {
  return `severity severity-${severity}`;
}

export default function App() {
  const { layers, issues, metrics, error } = useDataQuality();
  const [layerFilter, setLayerFilter] = useState("all");
  const [selectedIssue, setSelectedIssue] = useState<DataQualityIssue | null>(null);

  const filteredIssues = useMemo(() => {
    if (layerFilter === "all") return issues;
    return issues.filter((issue) => issue.layer_id === layerFilter);
  }, [issues, layerFilter]);

  return (
    <main className="layout">
      <section className="hero">
        <div>
          <p className="eyebrow">Mapbox portfolio project</p>
          <h1>Map Data Quality Lab</h1>
          <p>
            Full-stack geospatial data tooling for OSM-derived infrastructure layers: layer catalog, data-quality issues,
            map inspection and operational metrics.
          </p>
        </div>
        {metrics && (
          <div className="metrics">
            <div><strong>{metrics.layers}</strong><span>layers</span></div>
            <div><strong>{metrics.total_issues}</strong><span>issues</span></div>
            <div><strong>{metrics.open_issues}</strong><span>open</span></div>
          </div>
        )}
      </section>

      {error && <div className="error">API error: {error}</div>}

      <section className="content">
        <div className="mapPanel">
          <MapView />
        </div>

        <aside className="sidePanel">
          <h2>Data Quality</h2>
          <label>
            Layer
            <select value={layerFilter} onChange={(event) => setLayerFilter(event.target.value)}>
              <option value="all">All layers</option>
              {layers.map((layer) => <option key={layer.id} value={layer.id}>{layer.label}</option>)}
            </select>
          </label>

          <div className="issueList">
            {filteredIssues.map((issue) => (
              <button key={issue.id} className="issue" onClick={() => setSelectedIssue(issue)}>
                <span className={severityClass(issue.severity)}>{issue.severity}</span>
                <strong>{issue.title}</strong>
                <small>{issue.layer_id} · {issue.category}</small>
              </button>
            ))}
          </div>

          {selectedIssue && (
            <div className="detail">
              <h3>{selectedIssue.title}</h3>
              <p><strong>Evidence:</strong> {selectedIssue.evidence}</p>
              <p><strong>Recommendation:</strong> {selectedIssue.recommendation}</p>
              <p><strong>Status:</strong> {selectedIssue.status}</p>
            </div>
          )}
        </aside>
      </section>

      <section className="catalog">
        <h2>Layer Catalog</h2>
        <div className="catalogGrid">
          {layers.map((layer) => (
            <article key={layer.id}>
              <h3>{layer.label}</h3>
              <p>{layer.source} · {layer.geometry}</p>
              <dl>
                <dt>features</dt><dd>{layer.feature_count}</dd>
                <dt>quality</dt><dd>{layer.quality_status}</dd>
                <dt>access</dt><dd>{layer.access}</dd>
              </dl>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
