"""Geospatial data extraction pipeline for Map Data Quality Lab."""

import os
from pathlib import Path


_MPLCONFIGDIR = Path(__file__).resolve().parents[1] / "data" / "previews" / ".matplotlib"
_MPLCONFIGDIR.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("MPLCONFIGDIR", str(_MPLCONFIGDIR))
