from types import SimpleNamespace

import pytest

from geo_pipeline import extract, runtime_osm


def test_query_failover_rejects_http_200_with_overpass_error(monkeypatch):
    urls = []

    def post(url, **kwargs):
        urls.append(url)
        payload = (
            {"elements": [], "remark": "runtime error: Query timed out"}
            if len(urls) == 1
            else {"elements": []}
        )
        return SimpleNamespace(status_code=200, json=lambda: payload)

    monkeypatch.setattr(extract.requests, "post", post)
    monkeypatch.setattr(extract.time, "sleep", lambda *_: None)
    monkeypatch.setattr(
        extract,
        "OVERPASS_ENDPOINTS",
        ["https://first.invalid/api/interpreter", "https://second.invalid/api/interpreter"],
    )
    result, endpoint = extract.query_overpass_ql_direct_with_endpoint(
        'node["amenity"="police"](50,19,51,20);'
    )
    assert result == {"elements": []}
    assert endpoint == urls[1]
    assert len(urls) == 2


def test_all_incomplete_responses_fail_instead_of_publishing_an_empty_snapshot(monkeypatch):
    monkeypatch.setattr(
        extract.requests,
        "post",
        lambda *a, **kw: SimpleNamespace(status_code=200, json=lambda: {"remark": "out of memory"}),
    )
    monkeypatch.setattr(extract.time, "sleep", lambda *_: None)
    with pytest.raises(ValueError, match="incomplete or failed"):
        extract.query_overpass_ql_direct_with_endpoint("node(50,19,51,20);")


def test_power_relation_endpoint_is_not_suffixed_twice(monkeypatch):
    urls = []

    def post(url, **kwargs):
        urls.append(url)
        return SimpleNamespace(raise_for_status=lambda: None, json=lambda: {"elements": []})

    monkeypatch.setattr(runtime_osm.requests, "post", post)
    result = runtime_osm._fetch_power_circuit_relation_elements_from_osm(
        {"type": "Polygon", "coordinates": [[[19, 50], [19.1, 50], [19.1, 50.1], [19, 50]]]}
    )
    assert result == []
    assert urls == [runtime_osm.OVERPASS_ENDPOINTS[0]]
    assert not urls[0].endswith("/interpreter/interpreter")
