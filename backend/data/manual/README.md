# Manual GIS Layers

This directory contains controlled manual GeoJSON inputs for Map Data Quality Lab.

Manual layers are not authoritative infrastructure data. They are used as clearly marked seed inputs for synthetic demo topology when public OSM data is incomplete and WMS/KIUT is only a visual reference.

Current layer:

- `rybnik_35km_power_seed_nodes.geojson` - seed nodes for future synthetic power topology generation.

Rules:

- Keep `source=manual_seed`.
- Keep `not_authoritative=true`.
- Do not copy KIUT/GESUT geometry from WMS raster tiles.
- Use QGIS only to place seed points and edit attributes.
- Generated synthetic lines must be stored separately from OSM-derived layers.
