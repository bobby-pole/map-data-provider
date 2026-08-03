export function PreviewHeader({ aoiId, featureCount, onSettingsClick }: { aoiId: string; featureCount: number; onSettingsClick: () => void }) {
  return (
    <header className="previewHeader">
      <div>
        <p className="eyebrow">Provider data inspector</p>
        <h1>Map Data Quality Lab</h1>
      </div>
      <div className="previewActions"><p className="previewContext">AOI <strong>{aoiId}</strong> · {featureCount} visible features</p><button type="button" className="settingsButton" onClick={onSettingsClick} aria-label="Open AOI settings">⚙ Settings</button></div>
    </header>
  );
}
