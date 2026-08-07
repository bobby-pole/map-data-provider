"""Registered AOI/domain adapters used by the refresh worker."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from geo_pipeline.cache import build_rybnik_bridges_cache, build_rybnik_emergency_cache, build_rybnik_gas_cache, build_rybnik_power_cache, build_rybnik_public_cache, build_rybnik_sewer_cache, build_rybnik_transport_cache, build_rybnik_water_cache, build_rybnik_industrial_cache
from geo_pipeline.domain_pack import build_rybnik_bridges_domain_pack, build_rybnik_emergency_domain_pack, build_rybnik_gas_domain_pack, build_rybnik_power_domain_pack, build_rybnik_public_domain_pack, build_rybnik_sewer_domain_pack, build_rybnik_transport_domain_pack, build_rybnik_water_domain_pack, build_rybnik_industrial_domain_pack
from geo_pipeline.query_catalog import BRIDGES_OSM_QUERY, EMERGENCY_OSM_QUERY, GAS_OSM_QUERY, PUBLIC_OSM_QUERY, OsmQueryDefinition, POWER_OSM_QUERY, SEWER_OSM_QUERY, TRANSPORT_OSM_QUERY, WATER_OSM_QUERY, INDUSTRIAL_OSM_QUERY


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


def _transport_live() -> None:
    raise AdapterError("Use the AOI runtime path for bounded transport OSM acquisition; the fixture adapter is offline-only.")


TRANSPORT_ADAPTER = DomainAdapter(
    aoi_alias="rybnik_60km",
    domain="transport",
    query=TRANSPORT_OSM_QUERY,
    build_fixture=lambda root: build_rybnik_transport_cache(root=root),
    run_live=_transport_live,
    build_domain_pack=lambda root: build_rybnik_transport_domain_pack(root=root),
)


def _bridges_live() -> None:
    raise AdapterError("Use the AOI runtime path for bounded bridges OSM acquisition; the fixture adapter is offline-only.")


BRIDGES_ADAPTER = DomainAdapter(
    aoi_alias="rybnik_60km",
    domain="bridges",
    query=BRIDGES_OSM_QUERY,
    build_fixture=lambda root: build_rybnik_bridges_cache(root=root),
    run_live=_bridges_live,
    build_domain_pack=lambda root: build_rybnik_bridges_domain_pack(root=root),
)


def _water_live() -> None:
    raise AdapterError("Use the AOI runtime path for bounded water OSM acquisition; the fixture adapter is offline-only.")


WATER_ADAPTER = DomainAdapter(
    aoi_alias="rybnik_60km",
    domain="water",
    query=WATER_OSM_QUERY,
    build_fixture=lambda root: build_rybnik_water_cache(root=root),
    run_live=_water_live,
    build_domain_pack=lambda root: build_rybnik_water_domain_pack(root=root),
)


def _gas_live() -> None:
    raise AdapterError("Use the AOI runtime path for bounded gas OSM acquisition; the fixture adapter is offline-only.")


GAS_ADAPTER = DomainAdapter(
    aoi_alias="rybnik_60km",
    domain="gas",
    query=GAS_OSM_QUERY,
    build_fixture=lambda root: build_rybnik_gas_cache(root=root),
    run_live=_gas_live,
    build_domain_pack=lambda root: build_rybnik_gas_domain_pack(root=root),
)


def _sewer_live() -> None:
    raise AdapterError("Use the AOI runtime path for bounded sewer OSM acquisition; the fixture adapter is offline-only.")


SEWER_ADAPTER = DomainAdapter(
    aoi_alias="rybnik_60km",
    domain="sewer",
    query=SEWER_OSM_QUERY,
    build_fixture=lambda root: build_rybnik_sewer_cache(root=root),
    run_live=_sewer_live,
    build_domain_pack=lambda root: build_rybnik_sewer_domain_pack(root=root),
)


def _industrial_live() -> None:
    raise AdapterError("Use the AOI runtime path for bounded industrial OSM acquisition; the fixture adapter is offline-only.")


INDUSTRIAL_ADAPTER = DomainAdapter(
    aoi_alias="rybnik_60km",
    domain="industrial",
    query=INDUSTRIAL_OSM_QUERY,
    build_fixture=lambda root: build_rybnik_industrial_cache(root=root),
    run_live=_industrial_live,
    build_domain_pack=lambda root: build_rybnik_industrial_domain_pack(root=root),
)

_ADAPTERS = {
    (POWER_ADAPTER.aoi_alias, POWER_ADAPTER.domain): POWER_ADAPTER,
    (EMERGENCY_ADAPTER.aoi_alias, EMERGENCY_ADAPTER.domain): EMERGENCY_ADAPTER,
    (PUBLIC_ADAPTER.aoi_alias, PUBLIC_ADAPTER.domain): PUBLIC_ADAPTER,
    (TRANSPORT_ADAPTER.aoi_alias, TRANSPORT_ADAPTER.domain): TRANSPORT_ADAPTER,
    (BRIDGES_ADAPTER.aoi_alias, BRIDGES_ADAPTER.domain): BRIDGES_ADAPTER,
    (WATER_ADAPTER.aoi_alias, WATER_ADAPTER.domain): WATER_ADAPTER,
    (GAS_ADAPTER.aoi_alias, GAS_ADAPTER.domain): GAS_ADAPTER,
    (SEWER_ADAPTER.aoi_alias, SEWER_ADAPTER.domain): SEWER_ADAPTER,
    (INDUSTRIAL_ADAPTER.aoi_alias, INDUSTRIAL_ADAPTER.domain): INDUSTRIAL_ADAPTER,
}


def resolve_adapter(aoi_alias: str, domain: str) -> DomainAdapter:
    try:
        return _ADAPTERS[(aoi_alias, domain)]
    except KeyError as error:
        raise AdapterError(f"Unsupported registered AOI/domain target: {aoi_alias}/{domain}") from error


def registered_adapters() -> tuple[DomainAdapter, ...]:
    return tuple(_ADAPTERS.values())
