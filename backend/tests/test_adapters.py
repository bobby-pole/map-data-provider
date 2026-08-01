from pathlib import Path

import pytest

from geo_pipeline.adapters import AdapterError, registered_adapters, resolve_adapter


def test_power_is_registered_through_a_versioned_query_catalog() -> None:
    adapter = resolve_adapter("rybnik_60km", "power")

    assert adapter in registered_adapters()
    assert adapter.query.source_registry_id == "openstreetmap"
    assert adapter.query.query_version == "power-osmnx/v1"
    assert adapter.query.tags["power"]


def test_unsupported_targets_fail_before_any_cache_path_is_published(tmp_path: Path) -> None:
    with pytest.raises(AdapterError, match="Unsupported registered AOI/domain target"):
        resolve_adapter("unknown", "power")
    assert not list(tmp_path.iterdir())
