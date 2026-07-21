import { MapView } from "./components/MapView";
import { useProviderPreview } from "./hooks/useApi";
import "./index.css";

export default function App() {
  const { layer, metadata, readiness, error } = useProviderPreview();
  return (
    <main className="layout">
      <section className="hero">
        <div>
          <p className="eyebrow">Provider dev-preview</p>
          <h1>Map Data Quality Lab</h1>
          <p>Inspect the cached, source-aware provider contract for the Rybnik power layer. This preview explains data readiness; it is not an operational or simulation interface.</p>
        </div>
        {metadata && <div className="metrics"><div><strong>{metadata.feature_count}</strong><span>features</span></div><div><strong>{readiness?.readiness ?? "unknown"}</strong><span>readiness</span></div></div>}
      </section>
      {error && <div className="error">Provider API error: {error}</div>}
      <section className="content">
        <div className="mapPanel"><MapView layer={layer} /></div>
        <aside className="sidePanel">
          <h2>Cached layer inspection</h2>
          {metadata ? <dl>
            <dt>source</dt><dd>{metadata.source}</dd><dt>source type</dt><dd>{metadata.source_type}</dd>
            <dt>confidence</dt><dd>{metadata.confidence}</dd><dt>snapshot</dt><dd>{metadata.snapshot_at}</dd>
            <dt>quality</dt><dd>{readiness?.quality_status ?? "unknown"}</dd><dt>highest issue</dt><dd>{readiness?.highest_issue_severity ?? "none"}</dd>
          </dl> : <p className="muted">Loading provider cache metadata…</p>}
          {metadata && <><h3>Known limitations</h3><ul>{metadata.limitations.map((item) => <li key={item}>{item}</li>)}</ul><p className="muted">Source query: {metadata.source_query}</p></>}
        </aside>
      </section>
    </main>
  );
}
