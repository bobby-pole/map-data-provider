import { Filter, Layers3, Ruler, Settings2, Wrench } from "lucide-react";

export type PreviewPanel = "layers" | "providers" | "legend" | "settings";

const items: Array<{ id: PreviewPanel | "activity"; label: string }> = [
  { id: "layers", label: "Layers" },
  { id: "providers", label: "Providers" },
  { id: "legend", label: "Legend" },
  { id: "settings", label: "AOI settings" },
  { id: "activity", label: "Activity" },
];

export function IconRail({
  activePanel,
  activityOpen,
  onPanel,
  onActivity,
}: {
  activePanel: PreviewPanel | null;
  activityOpen: boolean;
  onPanel: (panel: PreviewPanel) => void;
  onActivity: () => void;
}) {
  return (
    <nav className="iconRail" aria-label="Preview controls">
      {items.map((item) => {
        const active = item.id === "activity" ? activityOpen : item.id === activePanel;
        return (
          <button
            key={item.id}
            type="button"
            className={active ? "iconRailButton active" : "iconRailButton"}
            title={item.label}
            aria-label={item.label}
            aria-pressed={active}
            onClick={() => (item.id === "activity" ? onActivity() : onPanel(item.id))}
          >
            <RailIcon name={item.id} />
            <span className="srOnly">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function RailIcon({ name }: { name: PreviewPanel | "activity" }) {
  const Icon = {
    layers: Layers3,
    providers: Filter,
    legend: Ruler,
    settings: Wrench,
    activity: Settings2,
  }[name];
  return <Icon className="railIcon" aria-hidden="true" strokeWidth={1.8} />;
}
