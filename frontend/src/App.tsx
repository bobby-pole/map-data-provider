import { useState } from "react";
import { MapView } from "./components/MapView";
import { useProviderPreview } from "./hooks/useApi";
import { configuredPreviewLayers, previewLayerKey, sourceAttribution } from "./previewCatalog";
import { filterIssuesByReviewState, isFinalReviewState, nextReviewStates, reviewStatuses } from "./reviewWorkflow";
import type { IssueReviewStatus, ProviderIssue } from "./types/api";
import "./index.css";

export default function App() {
  const { aoiId, domainPacks, issues, updateReview, error } = useProviderPreview();
  const [filter, setFilter] = useState<IssueReviewStatus | "all">("all");
  const [enabledLayers, setEnabledLayers] = useState<Record<string, boolean>>({});
  const [draftStates, setDraftStates] = useState<Record<string, Exclude<IssueReviewStatus, "open">>>({});
  const [draftNotes, setDraftNotes] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const visibleIssues = filterIssuesByReviewState(issues, filter);
  const catalog = configuredPreviewLayers(domainPacks);
  const visibleLayers = catalog.filter((layer) => enabledLayers[previewLayerKey(layer)] ?? true);
  const featureCount = visibleLayers.reduce((total, layer) => total + layer.layer.features.length, 0);

  async function saveReview(issue: ProviderIssue) {
    const status = draftStates[issue.id];
    if (!status || saving) return;
    setSaving(issue.id);
    try {
      await updateReview(issue, status, draftNotes[issue.id] ?? issue.review.note ?? "");
      setDraftStates((current) => {
        const remaining = { ...current };
        delete remaining[issue.id];
        return remaining;
      });
    } finally {
      setSaving(null);
    }
  }
  return (
    <main className="layout">
      <section className="hero">
        <div>
          <p className="eyebrow">Provider dev-preview</p>
          <h1>Map Data Quality Lab</h1>
          <p>Inspect cached, source-aware domain packs for AOI {aoiId}. This preview explains data readiness; it is not an operational or simulation interface.</p>
        </div>
        <div className="metrics"><div><strong>{featureCount}</strong><span>visible features</span></div><div><strong>{domainPacks.length}</strong><span>domain packs</span></div></div>
      </section>
      {error && <div className="error">Provider API error: {error}</div>}
      <section className="content">
        <div className="mapPanel"><MapView layers={visibleLayers} /></div>
        <aside className="sidePanel">
          <h2>Manifest layer catalog</h2>
          {catalog.length > 0 ? <div className="layerCatalog">{catalog.map((layer) => {
            const key = previewLayerKey(layer);
            return <article className="layerCard" key={key}>
              <label className="toggle"><input type="checkbox" checked={enabledLayers[key] ?? true} onChange={(event) => setEnabledLayers((current) => ({ ...current, [key]: event.target.checked }))} /><span>{layer.artifact.id}</span></label>
              <dl>
                <dt>domain</dt><dd>{layer.domain}</dd><dt>features</dt><dd>{layer.layer.features.length}</dd>
                <dt>readiness</dt><dd>{layer.readiness.readiness}</dd><dt>confidence</dt><dd>{layer.layer.metadata.confidence}</dd>
              </dl>
              <p className="muted">Source: {sourceAttribution(layer)}</p>
              <ul>{layer.layer.metadata.limitations.map((item) => <li key={item}>{item}</li>)}</ul>
            </article>;
          })}</div> : <p className="muted">Loading registered domain-pack manifests…</p>}
          <section className="reviewPanel">
            <h3>Issue review</h3>
            <p className="muted">Human review is separate from generated evidence and does not alter readiness.</p>
            <label>Filter review state
              <select value={filter} onChange={(event) => setFilter(event.target.value as IssueReviewStatus | "all") }>
                <option value="all">all states</option>{reviewStatuses.map((status) => <option key={status} value={status}>{status}</option>)}
              </select>
            </label>
            <div className="issueList">
              {visibleIssues.map((issue) => <article className="issue" key={issue.id}>
                <span className={`severity severity-${issue.severity}`}>{issue.severity}</span>
                <strong>{issue.title}</strong><small>{issue.rule_id} v{issue.rule_version} · {issue.review.status}</small>
                <p>{issue.evidence}</p><small>{issue.recommendation}</small>
                {isFinalReviewState(issue.review.status) ? <p className="muted">Final decision{issue.review.note ? `: ${issue.review.note}` : "."}</p> : <>
                  <label>Next review state
                    <select value={draftStates[issue.id] ?? ""} onChange={(event) => setDraftStates((current) => ({ ...current, [issue.id]: event.target.value as Exclude<IssueReviewStatus, "open"> }))}>
                      <option value="">select allowed state</option>{nextReviewStates(issue.review.status).map((status) => <option key={status} value={status}>{status}</option>)}
                    </select>
                  </label>
                  <label>Optional review note
                    <textarea value={draftNotes[issue.id] ?? issue.review.note ?? ""} onChange={(event) => setDraftNotes((current) => ({ ...current, [issue.id]: event.target.value }))} maxLength={1000} />
                  </label>
                  <button type="button" disabled={!draftStates[issue.id] || saving === issue.id} onClick={() => void saveReview(issue)}>{saving === issue.id ? "Saving…" : "Save review"}</button>
                </>}
              </article>)}
              {issues.length > 0 && visibleIssues.length === 0 && <p className="muted">No issues match this review state.</p>}
            </div>
          </section>
        </aside>
      </section>
    </main>
  );
}
