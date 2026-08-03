"""Build committed MDQ-050 OSM support and circuit fixtures from one captured snapshot."""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data/fixtures/rybnik_60km/power"
BBOX = [17.7072648, 49.5643805, 19.3851569, 50.6410717]
TAGS = ("power", "man_made", "name", "name:pl", "name:en", "alt_name", "description", "ref", "operator", "operator:short", "operator:wikidata", "wikidata", "wikipedia", "website", "image", "voltage", "voltage:primary", "voltage:secondary", "frequency", "circuits", "cables", "wires", "phases", "location", "line", "rating", "design", "height", "material", "tower:type", "tower:construction", "substation", "transformer", "generator:source", "generator:method", "generator:type", "plant:source", "plant:method", "plant:output:electricity", "start_date")

def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

def main() -> None:
    supports_path, circuits_path, tags_path = map(Path, sys.argv[1:4])
    supports = json.loads(supports_path.read_text())
    circuits = json.loads(circuits_path.read_text())
    tags_payload = json.loads(tags_path.read_text())
    # Preserve the upstream snapshot timestamp rather than the local build time.
    # Re-running this transformer must not silently turn an old download into a
    # new source snapshot.
    snapshot_at = max(
        str(supports.get("osm3s", {}).get("timestamp_osm_base", "")),
        str(circuits.get("osm3s", {}).get("timestamp_osm_base", "")),
    )
    if not snapshot_at.endswith("Z"):
        raise ValueError("Captured Overpass responses require an OSM snapshot timestamp")
    features = []
    for item in supports["elements"]:
        tags = item.get("tags", {})
        kind = tags.get("power") or ("utility_pole" if tags.get("man_made") == "utility_pole" else None)
        if kind not in {"tower", "pole", "portal", "utility_pole"}: continue
        projected = {key: tags[key] for key in TAGS if key in tags}
        features.append({"type":"Feature", "properties":{"element":"node", "id":item["id"], **projected}, "geometry":{"type":"Point", "coordinates":[item["lon"], item["lat"]]}})
    fc = {"type":"FeatureCollection", "metadata":{"source":"OpenStreetMap", "snapshot_at":snapshot_at, "source_query":"Captured bounded Overpass support snapshot for Rybnik 60 km AOI.", "source_url":"https://overpass-api.de/api/interpreter", "attribution":"© OpenStreetMap contributors", "license":"ODbL-1.0", "bbox":BBOX, "source_checksum":digest(supports_path), "coverage":"bounded_aoi_snapshot"}, "features":features}
    (OUT / "osm-power-supports-full.geojson").write_text(json.dumps(fc, ensure_ascii=False), encoding="utf-8")
    elements = {(item["type"], item["id"]): item for item in circuits["elements"]}
    nodes = {key[1]: value for key, value in elements.items() if key[0] == "node"}
    result = []
    reverse: dict[str, list[str]] = {}
    for relation in (item for item in circuits["elements"] if item["type"] == "relation"):
        members = []
        for member in relation.get("members", []):
            source_id = f'{member["type"]}/{member["ref"]}'
            record = {"source_id":source_id, "role":member.get("role", "")}
            if member["type"] == "way" and (way := elements.get(("way", member["ref"]))):
                member_nodes = [node for node in way.get("nodes", []) if node in nodes]
                coords = [[nodes[node]["lon"], nodes[node]["lat"]] for node in member_nodes]
                if len(coords) > 1: record["geometry"] = {"type":"LineString", "coordinates":coords}
                else: record["availability"] = "missing_member_geometry"
                if len(member_nodes) > 1:
                    record["endpoint_evidence"] = {"start": f"node/{member_nodes[0]}", "end": f"node/{member_nodes[-1]}"}
                # A support node is part of a circuit only when it is an actual
                # OSM node of a committed member way.  This creates the reverse
                # lookup used by the UI without geometric proximity inference.
                for node_id in way.get("nodes", []):
                    if node_id in nodes:
                        reverse.setdefault(f"node/{node_id}", []).append(f'relation/{relation["id"]}')
            else: record["availability"] = "missing_member_geometry"
            members.append(record); reverse.setdefault(source_id, []).append(f'relation/{relation["id"]}')
        result.append({"relation_id":f'relation/{relation["id"]}', "tags":relation.get("tags", {}), "aoi_coverage":"bounded_source_snapshot", "members":members, "limitations":["Only captured OSM members and geometry are shown.", "No connectivity, flow, outage or cascade model is implied."]})
    payload = {"relation_evidence_version":"osm_power_relation_evidence/v2", "source":"OpenStreetMap", "snapshot_at":snapshot_at, "bbox":BBOX, "source_checksum":digest(circuits_path), "relations":result, "reverse_member_index":reverse}
    (OUT / "osm-power-circuit-evidence.json").write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    tag_snapshot_at = str(tags_payload.get("osm3s", {}).get("timestamp_osm_base", ""))
    if not tag_snapshot_at.endswith("Z"):
        raise ValueError("Captured OSM tag response requires an OSM snapshot timestamp")
    records = {
        f'{item["type"]}/{item["id"]}': {key: tags[key] for key in TAGS if key in (tags := item.get("tags", {}))}
        for item in tags_payload["elements"]
        if item["type"] in {"node", "way", "relation"} and item.get("tags")
    }
    attributes = {"attribute_evidence_version":"osm_power_attributes/v1", "source":"OpenStreetMap", "snapshot_at":tag_snapshot_at, "bbox":BBOX, "source_checksum":digest(tags_path), "attributes":records}
    (OUT / "osm-power-attributes.json").write_text(json.dumps(attributes, ensure_ascii=False), encoding="utf-8")

if __name__ == "__main__": main()
