from pathlib import Path

import geopandas as gpd


def write_power_preview(lines: gpd.GeoDataFrame, nodes: gpd.GeoDataFrame, path: Path) -> None:
    if lines.empty and nodes.empty:
        return

    import os

    os.environ.setdefault("MPLCONFIGDIR", str(path.parent / ".matplotlib"))
    import matplotlib.pyplot as plt

    path.parent.mkdir(parents=True, exist_ok=True)
    fig, ax = plt.subplots(figsize=(12, 12))
    fig.patch.set_facecolor("#111111")
    ax.set_facecolor("#111111")

    if not lines.empty:
        lines.plot(ax=ax, color="#22c55e", linewidth=0.8, alpha=0.75)
    if not nodes.empty:
        nodes.plot(ax=ax, color="#ef4444", markersize=8, alpha=0.9)

    ax.set_title("Power infrastructure - Rybnik + 60 km", color="white", fontsize=16)
    ax.set_axis_off()
    plt.tight_layout()
    plt.savefig(path, dpi=220)
    plt.close(fig)
