export function PreviewHeader({ aoiId, featureCount }: { aoiId: string; featureCount: number }) {
  return (
    <header className="previewHeader">
      <div>
        <p className="eyebrow">Provider data inspector</p>
        <h1>Map Data Quality Lab</h1>
      </div>
      <p className="previewContext">AOI <strong>{aoiId}</strong> · {featureCount} visible features</p>
    </header>
  );
}
