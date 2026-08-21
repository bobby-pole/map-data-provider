from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class AoiConfig:
    name: str
    center_lat: float
    center_lon: float
    radius_m: int

    @property
    def center(self) -> tuple[float, float]:
        return (self.center_lat, self.center_lon)


RYBNIK_AOI = AoiConfig(
    name="rybnik_35km",
    center_lat=50.102174,
    center_lon=18.546285,
    radius_m=35_000,
)

BACKEND_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BACKEND_DIR / "data"
RAW_DIR = DATA_DIR / "raw"
MANUAL_DIR = DATA_DIR / "manual"
PROCESSED_DIR = DATA_DIR / "processed"
GEOJSON_DIR = DATA_DIR / "geojson"
PREVIEWS_DIR = DATA_DIR / "previews"
REPORTS_DIR = DATA_DIR / "reports"
CACHE_DIR = DATA_DIR / "cache"
# Runtime request outcomes are local, mutable cache state.  They deliberately
# live outside committed fixture evidence under data/cache.
RUNTIME_CACHE_DIR = BACKEND_DIR / "cache"


def ensure_data_dirs() -> None:
    for path in (
        RAW_DIR,
        MANUAL_DIR,
        PROCESSED_DIR,
        GEOJSON_DIR,
        PREVIEWS_DIR,
        REPORTS_DIR,
        CACHE_DIR,
    ):
        path.mkdir(parents=True, exist_ok=True)
