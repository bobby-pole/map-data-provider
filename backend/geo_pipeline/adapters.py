"""Registered AOI/domain adapters used by the refresh worker."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from geo_pipeline.cache import build_rybnik_emergency_cache, build_rybnik_power_cache, build_rybnik_public_cache
from geo_pipeline.domain_pack import build_rybnik_emergency_domain_pack, build_rybnik_power_domain_pack, build_rybnik_public_domain_pack
from geo_pipeline.query_catalog import EMERGENCY_OSM_QUERY, PUBLIC_OSM_QUERY, OsmQueryDefinition, POWER_OSM_QUERY


class AdapterError(ValueError):
    """A deterministic adapter-catalog error."""


@dataclass(frozen=True)
class DomainAdapter:
    aoi_alias: str
    domain: str
    query: OsmQueryDefinition
    build_fixture: Callable[[Path], dict]
    run_live: Callable[[], None]
    build_domain_pack: Callable[[Path], dict]


def _power_live() -> None:
    from geo_pipeline.layers.power import extract_power_grid

    extract_power_grid(write_preview=False)


POWER_ADAPTER = DomainAdapter(
    aoi_alias="rybnik_60km",
    domain="power",
    query=POWER_OSM_QUERY,
    build_fixture=lambda root: build_rybnik_power_cache(root=root),
    run_live=_power_live,
    build_domain_pack=lambda root: build_rybnik_power_domain_pack(root=root),
)


def _emergency_live() -> None:
    raise AdapterError(
        "Live emergency acquisition is not enabled. Use the committed, source-dated fixture mode until a separately qualified refresh workflow is added."
    )


EMERGENCY_ADAPTER = DomainAdapter(
    aoi_alias="rybnik_60km",
    domain="emergency",
    query=EMERGENCY_OSM_QUERY,
    build_fixture=lambda root: build_rybnik_emergency_cache(root=root),
    run_live=_emergency_live,
    build_domain_pack=lambda root: build_rybnik_emergency_domain_pack(root=root),
)


def _public_live() -> None:
    raise AdapterError("Use the AOI runtime path for bounded public-service OSM acquisition; the fixture adapter is offline-only.")


PUBLIC_ADAPTER = DomainAdapter(
    aoi_alias="rybnik_60km",
    domain="public",
    query=PUBLIC_OSM_QUERY,
    build_fixture=lambda root: build_rybnik_public_cache(root=root),
    run_live=_public_live,
    build_domain_pack=lambda root: build_rybnik_public_domain_pack(root=root),
)

_ADAPTERS = {
    (POWER_ADAPTER.aoi_alias, POWER_ADAPTER.domain): POWER_ADAPTER,
    (EMERGENCY_ADAPTER.aoi_alias, EMERGENCY_ADAPTER.domain): EMERGENCY_ADAPTER,
    (PUBLIC_ADAPTER.aoi_alias, PUBLIC_ADAPTER.domain): PUBLIC_ADAPTER,
}


def resolve_adapter(aoi_alias: str, domain: str) -> DomainAdapter:
    try:
        return _ADAPTERS[(aoi_alias, domain)]
    except KeyError as error:
        raise AdapterError(f"Unsupported registered AOI/domain target: {aoi_alias}/{domain}") from error


def registered_adapters() -> tuple[DomainAdapter, ...]:
    return tuple(_ADAPTERS.values())
