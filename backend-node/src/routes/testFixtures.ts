import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

type GeoJsonFeature = {
  type: "Feature";
  properties: Record<string, unknown>;
  geometry: {
    type: string;
    coordinates: unknown;
  };
};

type ArtifactSpec = {
  id: string;
  source_layer: string;
  geometry_kind: "point" | "line" | "polygon";
  features: GeoJsonFeature[];
  public_export: boolean;
  source_provenance?: Array<{
    source_id: string;
    contribution_role: "primary" | "supplementary" | "validation_reference" | "derived_context";
  }>;
};

type ManifestArtifact = {
  id: string;
  kind: string;
  format: string;
  path?: string;
  sha256?: string;
  feature_count?: number;
  source_provenance: Array<{
    source_id: string;
    contribution_role: "primary" | "supplementary" | "validation_reference" | "derived_context";
  }>;
  public_export: boolean;
};

type PresentationLayer = {
  artifact_id: string;
  source_layer: string;
  feature_count: number;
  source: string;
  confidence: "high" | "medium" | "low" | "not_applicable";
  readiness: "ready" | "usable_with_limitations" | "needs_source" | "not_usable";
  limitations: string[];
  attribution: string;
  source_provenance: Array<{
    source_id: string;
    contribution_role: "primary" | "supplementary" | "validation_reference" | "derived_context";
  }>;
};

export async function seedCompactRybnikCache(cacheRoot: string): Promise<void> {
  const aoiId = "rybnik_35km";
  const domains = [
    "power",
    "emergency",
    "gas",
    "telecom",
    "district_heating",
    "public",
    "transport",
    "bridges",
    "water",
    "sewer",
    "industrial",
  ];

  for (const domain of domains) {
    const domainRoot = path.join(cacheRoot, aoiId, domain);
    const packRoot = path.join(domainRoot, "domain-pack-v2");
    await mkdir(path.join(packRoot, "layers"), { recursive: true });
    await mkdir(path.join(packRoot, "validation"), { recursive: true });
    await mkdir(path.join(packRoot, "readiness"), { recursive: true });
    await mkdir(path.join(packRoot, "presentation"), { recursive: true });
    await mkdir(path.join(packRoot, "native"), { recursive: true });

    let queryVersion = `${domain}-osm/v1`;
    let limitations = ["OSM completeness varies by area."];
    const qualityStatus = "passed";
    let readiness: "ready" | "usable_with_limitations" | "needs_source" | "not_usable" =
      "usable_with_limitations";
    let highestSeverity: "low" | "medium" | "high" | null = null;

    if (domain === "power") {
      queryVersion = "power-osmnx/v1";
      limitations = ["OSM completeness varies by area and asset type."];
      readiness = "usable_with_limitations";
      highestSeverity = "medium";
    } else if (domain === "gas") {
      queryVersion = "gas-osm/v2";
      limitations = ["Not a complete Rybnik 35 km OSM snapshot."];
    } else if (domain === "telecom") {
      queryVersion = "telecom-osm/v1";
      limitations = ["KIUT telecom WMS layers are visual reference overlays only."];
    } else if (domain === "district_heating") {
      queryVersion = "district-heating-osm/v1";
      limitations = ["KIUT district-heating WMS is visual reference-only imagery."];
    }

    const defaultSourceProvenance: Array<{
      source_id: string;
      contribution_role: "primary" | "supplementary" | "validation_reference" | "derived_context";
    }> = [{ source_id: "openstreetmap", contribution_role: "primary" }];

    let artifactSpecs: ArtifactSpec[] = [];
    const extraManifestArtifacts: ManifestArtifact[] = [];
    const packSourceProvenance = [...defaultSourceProvenance];

    if (domain === "power") {
      packSourceProvenance.push({
        source_id: "kiut_gesut_wms",
        contribution_role: "validation_reference",
      });
      artifactSpecs = [
        {
          id: "power.lines",
          source_layer: "power_lines",
          geometry_kind: "line",
          public_export: true,
          features: [
            {
              type: "Feature",
              properties: {
                source_id: "way/185080408",
                asset_type: "line",
                voltage: "220000",
                source: "OpenStreetMap",
                confidence: "medium",
                limitations,
                osm_tags: { power: "line" },
              },
              geometry: {
                type: "LineString",
                coordinates: [
                  [18.5, 50.1],
                  [18.6, 50.2],
                ],
              },
            },
          ],
        },
        {
          id: "power.supports",
          source_layer: "power_supports",
          geometry_kind: "point",
          public_export: true,
          features: [
            {
              type: "Feature",
              properties: {
                source_id: "node/1528794574",
                asset_type: "tower",
                source: "OpenStreetMap",
                confidence: "medium",
                limitations,
                osm_tags: { power: "tower", operator: "Tauron" },
              },
              geometry: { type: "Point", coordinates: [18.54, 50.12] },
            },
            {
              type: "Feature",
              properties: {
                source_id: "node/1758555079",
                asset_type: "tower",
                source: "OpenStreetMap",
                confidence: "medium",
                limitations,
                osm_tags: { power: "tower" },
              },
              geometry: { type: "Point", coordinates: [18.55, 50.13] },
            },
          ],
        },
        {
          id: "power.assets",
          source_layer: "power_assets",
          geometry_kind: "polygon",
          public_export: true,
          features: [
            {
              type: "Feature",
              properties: {
                source_id: "relation/12825526",
                asset_type: "plant",
                source: "OpenStreetMap",
                confidence: "medium",
                limitations,
                osm_tags: {
                  wikipedia: "pl:Elektrownia Rybnik",
                  wikidata: "Q751203",
                  website: "https://elrybnik.pgegiek.pl/o-oddziale",
                },
              },
              geometry: {
                type: "Polygon",
                coordinates: [
                  [
                    [18.5, 50.1],
                    [18.51, 50.1],
                    [18.51, 50.11],
                    [18.5, 50.1],
                  ],
                ],
              },
            },
          ],
        },
      ];
    } else if (domain === "emergency") {
      packSourceProvenance.push({ source_id: "prg_wfs", contribution_role: "primary" });
      artifactSpecs = [
        {
          id: "emergency.hospital",
          source_layer: "emergency_hospital",
          geometry_kind: "polygon",
          public_export: true,
          source_provenance: [{ source_id: "openstreetmap", contribution_role: "primary" }],
          features: [
            {
              type: "Feature",
              properties: {
                source_id: "way/39829907",
                source: "OpenStreetMap",
                asset_type: "hospital",
                confidence: "medium",
                limitations,
                osm_tags: { amenity: "hospital" },
              },
              geometry: {
                type: "Polygon",
                coordinates: [
                  [
                    [18.5, 50.1],
                    [18.51, 50.1],
                    [18.51, 50.11],
                    [18.5, 50.1],
                  ],
                ],
              },
            },
          ],
        },
        {
          id: "emergency.official_police",
          source_layer: "emergency_police",
          geometry_kind: "point",
          public_export: true,
          source_provenance: [{ source_id: "prg_wfs", contribution_role: "primary" }],
          features: [
            {
              type: "Feature",
              properties: {
                source_id: "prg_k02/1350186",
                source: "PRG (official unit-area evidence)",
                source_geometry_type: "MultiSurface",
                source_attributes: { official_type: "K02_Komenda_powiatowa_policji" },
                confidence: "high",
                limitations,
              },
              geometry: { type: "Point", coordinates: [18.52, 50.11] },
            },
          ],
        },
      ];
    } else if (domain === "telecom") {
      packSourceProvenance.push({
        source_id: "kiut_gesut_wms",
        contribution_role: "validation_reference",
      });
      artifactSpecs = [
        "telecom.towers",
        "telecom.facilities",
        "telecom.lines",
        "telecom.inspection_points",
      ].map((id, index) => ({
        id,
        source_layer: id.replace(".", "_"),
        geometry_kind: index % 2 === 0 ? "point" : "line",
        public_export: true,
        features: [
          {
            type: "Feature" as const,
            properties: {
              source_id: `${id}_0`,
              asset_type: id,
              source: "OpenStreetMap",
              confidence: "medium",
              limitations,
            },
            geometry: { type: "Point", coordinates: [18.546, 50.102] },
          },
        ],
      }));
      extraManifestArtifacts.push({
        id: "telecom.reference",
        kind: "remote_service",
        format: "wms",
        source_provenance: [
          { source_id: "kiut_gesut_wms", contribution_role: "validation_reference" },
        ],
        public_export: false,
      });
    } else if (domain === "district_heating") {
      packSourceProvenance.push({
        source_id: "kiut_gesut_wms",
        contribution_role: "validation_reference",
      });
      artifactSpecs = [
        "district_heating.plants",
        "district_heating.facilities",
        "district_heating.lines",
        "district_heating.inspection_points",
      ].map((id, index) => ({
        id,
        source_layer: id.replace(".", "_"),
        geometry_kind: index % 2 === 0 ? "point" : "line",
        public_export: true,
        features: [
          {
            type: "Feature" as const,
            properties: {
              source_id: `${id}_0`,
              asset_type: id,
              source: "OpenStreetMap",
              confidence: "medium",
              limitations,
            },
            geometry: { type: "Point", coordinates: [18.546, 50.102] },
          },
        ],
      }));
      extraManifestArtifacts.push({
        id: "district_heating.reference",
        kind: "remote_service",
        format: "wms",
        source_provenance: [
          { source_id: "kiut_gesut_wms", contribution_role: "validation_reference" },
        ],
        public_export: false,
      });
    } else if (domain === "industrial") {
      artifactSpecs = [
        "industrial.sites",
        "industrial.facilities",
        "industrial.lines",
        "industrial.inspection_points",
      ].map((id, index) => ({
        id,
        source_layer: id.replace(".", "_"),
        geometry_kind: index % 2 === 0 ? "point" : "line",
        public_export: true,
        features: [
          {
            type: "Feature" as const,
            properties: {
              source_id: `${id}_0`,
              asset_type: id,
              source: "OpenStreetMap",
              confidence: "medium",
              limitations,
            },
            geometry: { type: "Point", coordinates: [18.546, 50.102] },
          },
        ],
      }));
    } else if (domain === "gas" || domain === "water" || domain === "sewer") {
      artifactSpecs = [
        `${domain}.facilities`,
        `${domain}.lines`,
        `${domain}.inspection_points`,
      ].map((id, index) => ({
        id,
        source_layer: id.replace(".", "_"),
        geometry_kind: index % 2 === 0 ? "point" : "line",
        public_export: true,
        features: [
          {
            type: "Feature" as const,
            properties: {
              source_id: `${id}_0`,
              asset_type: id,
              source: "OpenStreetMap",
              confidence: "medium",
              limitations,
            },
            geometry: { type: "Point", coordinates: [18.546, 50.102] },
          },
        ],
      }));
    } else if (domain === "transport" || domain === "bridges") {
      artifactSpecs = [`${domain}.lines`, `${domain}.facilities`].map((id, index) => ({
        id,
        source_layer: id.replace(".", "_"),
        geometry_kind: index % 2 === 0 ? "line" : "point",
        public_export: true,
        features: [
          {
            type: "Feature" as const,
            properties: {
              source_id: `${id}_0`,
              asset_type: id,
              source: "OpenStreetMap",
              confidence: "medium",
              limitations,
            },
            geometry: { type: "Point", coordinates: [18.546, 50.102] },
          },
        ],
      }));
    } else {
      artifactSpecs = [
        {
          id: `${domain}.facilities`,
          source_layer: `${domain}_facilities`,
          geometry_kind: "point",
          public_export: true,
          features: [
            {
              type: "Feature",
              properties: {
                source_id: `${domain}_0`,
                asset_type: `${domain} fixture`,
                source: "OpenStreetMap",
                confidence: "medium",
                limitations,
              },
              geometry: { type: "Point", coordinates: [18.546, 50.102] },
            },
          ],
        },
      ];
    }

    const mainArtifact = artifactSpecs[0]!;
    const mainFeatureCount = domain === "power" ? 6796 : mainArtifact.features.length;

    const baseMetadata = {
      cache_layout_version: "provider_cache/v1" as const,
      geojson_contract_version: "provider_geojson/v1" as const,
      aoi_id: aoiId,
      domain,
      layer_id: mainArtifact.id,
      source: "OpenStreetMap",
      source_type: "analytical_vector" as const,
      source_registry_id: "openstreetmap",
      source_url: "https://example.test/source",
      source_query: `${domain} query`,
      snapshot_at: "2026-08-01T00:00:00Z",
      pipeline_version: "geo_pipeline/cache/v1",
      query_version: queryVersion,
      validation_status_raw: "pass",
      quality_status: qualityStatus,
      confidence: "medium" as const,
      limitations,
      eligible_for_analysis: true,
      readiness,
      feature_count: mainFeatureCount,
    };

    const mainLayer = {
      type: "FeatureCollection",
      metadata: {
        ...baseMetadata,
        contract_version: "provider_geojson/v1" as const,
      },
      features: mainArtifact.features,
    };
    await writeFile(path.join(domainRoot, "layer.geojson"), JSON.stringify(mainLayer));
    await writeFile(path.join(domainRoot, "metadata.json"), JSON.stringify(baseMetadata));

    const readinessPayload = {
      cache_layout_version: "provider_cache/v1" as const,
      aoi_id: aoiId,
      domain,
      layer_id: mainArtifact.id,
      readiness,
      quality_status: qualityStatus,
      highest_issue_severity: highestSeverity,
      feature_count: mainFeatureCount,
      evaluated_at: "2026-08-01T00:00:00Z",
    };
    await writeFile(path.join(domainRoot, "readiness.json"), JSON.stringify(readinessPayload));

    // Write domain-pack-v2 layers
    const packArtifacts: ManifestArtifact[] = [];
    const presentationLayers: PresentationLayer[] = [];

    for (const spec of artifactSpecs) {
      const layerMetadata = {
        ...baseMetadata,
        layer_id: spec.id,
        feature_count: spec.features.length,
        geojson_contract_version: "provider_geojson/v1" as const,
        contract_version: "provider_geojson/v1" as const,
      };
      const layerPayload = Buffer.from(
        JSON.stringify({
          type: "FeatureCollection",
          metadata: layerMetadata,
          features: spec.features,
        }),
      );
      const layerFilename = `${spec.id}.geojson`;
      await writeFile(path.join(packRoot, "layers", layerFilename), layerPayload);

      const prov = spec.source_provenance ?? defaultSourceProvenance;
      packArtifacts.push({
        id: spec.id,
        kind: "processed_vector",
        format: "geojson",
        path: `layers/${layerFilename}`,
        sha256: sha256(layerPayload),
        feature_count: spec.features.length,
        source_provenance: prov,
        public_export: spec.public_export,
      });

      presentationLayers.push({
        artifact_id: spec.id,
        source_layer: spec.source_layer,
        feature_count:
          domain === "power" && spec.id === "power.lines" ? 6796 : spec.features.length,
        source:
          spec.id === "emergency.official_police"
            ? "PRG (official unit-area evidence)"
            : "OpenStreetMap",
        confidence: spec.id === "emergency.official_police" ? "high" : "medium",
        readiness: "usable_with_limitations",
        limitations: spec.id === "emergency.official_police" ? [] : limitations,
        attribution:
          spec.id === "emergency.official_police"
            ? "© GUGiK (PRG)"
            : "© OpenStreetMap contributors",
        source_provenance: prov,
      });
    }

    if (domain === "power") {
      const circuitPayload = {
        relation_evidence_version: "osm_power_relation_evidence/v2",
        source: "OpenStreetMap",
        snapshot_at: "2026-08-01T00:00:00Z",
        bbox: [18.0, 49.8, 19.0, 50.4],
        source_checksum: "0000000000000000000000000000000000000000000000000000000000000000",
        relations: [
          {
            relation_id: "relation/19511895",
            tags: { voltage: "110000", operator: "Tauron" },
            aoi_coverage: "bounded_source_snapshot",
            limitations: ["Bounded OSM snapshot."],
            members: [{ source_id: "way/185080408", role: "" }],
          },
        ],
        reverse_member_index: {
          "way/185080408": ["relation/19511895"],
        },
      };
      const circuitBytes = Buffer.from(JSON.stringify(circuitPayload));
      await writeFile(
        path.join(packRoot, "native", "osm-power-circuit-evidence.json"),
        circuitBytes,
      );

      packArtifacts.push({
        id: "power.osm_relation_evidence",
        kind: "native_vector",
        format: "json",
        path: "native/osm-power-circuit-evidence.json",
        sha256: sha256(circuitBytes),
        source_provenance: defaultSourceProvenance,
        public_export: false,
      });
    }

    // Append extra non-exported artifacts
    packArtifacts.push(...extraManifestArtifacts);

    // Write validation & readiness records
    await writeFile(
      path.join(packRoot, "validation", "metadata.json"),
      JSON.stringify(baseMetadata),
    );
    await writeFile(
      path.join(packRoot, "readiness", "readiness.json"),
      JSON.stringify(readinessPayload),
    );

    // PMTiles presentation archive
    const pmtilesBuffer = Buffer.alloc(1024, 0x4d);
    const pmtilesSha256 = sha256(pmtilesBuffer);
    await writeFile(path.join(packRoot, "presentation", `${domain}.pmtiles`), pmtilesBuffer);

    const domainManifest = {
      domain_pack_version: "provider_domain_pack/v2" as const,
      aoi_id: aoiId,
      domain,
      source_provenance: packSourceProvenance,
      artifacts: packArtifacts,
      validation: { path: "validation/metadata.json" },
      readiness: { path: "readiness/readiness.json" },
    };

    const manifestSha256 = sha256(Buffer.from(canonicalJson(domainManifest)));

    const presentationManifest = {
      presentation_version: "provider_map_presentation/v1" as const,
      aoi_id: aoiId,
      domain,
      parent_domain_pack: {
        version: "provider_domain_pack/v2" as const,
        sha256: manifestSha256,
      },
      archive: {
        format: "pmtiles" as const,
        path: `${domain}.pmtiles`,
        sha256: pmtilesSha256,
        size_bytes: pmtilesBuffer.length,
        min_zoom: 7,
        max_zoom: 14,
        bounds: [18.0, 49.8, 19.0, 50.4] as [number, number, number, number],
      },
      layers: presentationLayers,
      attribution: "© OpenStreetMap contributors",
      benchmark: {
        benchmark_version: "provider_map_presentation_benchmark/v1" as const,
        baseline: {
          delivery: "full_geojson_to_leaflet" as const,
          feature_count: mainFeatureCount,
          payload_bytes: 50000,
        },
        presentation: {
          delivery: "pmtiles_mvt_range_reads" as const,
          archive_bytes: pmtilesBuffer.length,
          addressed_tiles: 1,
          min_zoom: 7,
          max_zoom: 14,
        },
      },
    };

    await writeFile(
      path.join(packRoot, "presentation", "manifest.json"),
      JSON.stringify(presentationManifest),
    );
    await writeFile(path.join(packRoot, "manifest.json"), JSON.stringify(domainManifest));
  }
}
