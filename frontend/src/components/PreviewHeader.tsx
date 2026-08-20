export function PreviewHeader({ aoiId, featureCount }: { aoiId?: string; featureCount: number }) {
  return (
    <header className="previewHeader">
      <div className="brandLockup">
        <svg className="brandMark" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 21s7-5.2 7-11A7 7 0 0 0 5 10c0 5.8 7 11 7 11Z" /><circle cx="12" cy="10" r="2.4" /></svg>
        <div><h1>Map Data Quality Lab</h1><p>Source-aware infrastructure provider</p></div>
      </div>
      <div className="previewActions"><p className="previewContext">{aoiId ? <>AOI <strong>{aoiId}</strong> · {featureCount} visible</> : "No AOI prepared"}</p></div>
    </header>
  );
}
