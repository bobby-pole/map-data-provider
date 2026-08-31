import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  availabilityForResolvedAoi,
  getRuntimeAcquisitionEvidence,
  listPreparedSnapshots,
} from "./preparedSnapshotService.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("prepared snapshot catalogue", () => {
  it("accepts an exact checksum-validated publication and does not overclaim nearby coverage", async () => {
    const root = await fixtureRoot();
    await writeSnapshot(root, { aoiId: "rybnik_50km", state: "ready" });
    const snapshots = await listPreparedSnapshots({ cacheRoot: root });

    expect(snapshots).toHaveLength(1);
    expect(
      availabilityForResolvedAoi(
        { aoi_id: "rybnik_50km", geometry: snapshots[0]!.coverage.geometry },
        snapshots,
      ),
    ).toMatchObject({ state: "ready", snapshot_ids: ["rybnik_50km"] });
    expect(
      availabilityForResolvedAoi(
        {
          aoi_id: "nearby_aoi",
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
        snapshots,
      ),
    ).toMatchObject({ state: "partial_coverage" });
  });

  it("reports queued and failed publications without treating them as ready", async () => {
    const root = await fixtureRoot();
    await writeSnapshot(root, { aoiId: "queued_aoi", state: "queued" });
    await writeSnapshot(root, { aoiId: "failed_aoi", state: "failed" });
    const snapshots = await listPreparedSnapshots({ cacheRoot: root });
    for (const [aoiId, state] of [
      ["queued_aoi", "queued"],
      ["failed_aoi", "failed"],
    ] as const) {
      expect(
        availabilityForResolvedAoi(
          {
            aoi_id: aoiId,
            geometry: snapshots.find((item) => item.aoi_id === aoiId)!.coverage.geometry,
          },
          snapshots,
        ).state,
      ).toBe(state);
    }
  });

  it("rejects a publication when a ready domain pack no longer matches its recorded checksum", async () => {
    const root = await fixtureRoot();
    await writeSnapshot(root, { aoiId: "corrupt_aoi", state: "ready" });
    await writeFile(
      path.join(root, "corrupt_aoi", "power", "domain-pack-v2", "manifest.json"),
      "changed",
    );
    await expect(listPreparedSnapshots({ cacheRoot: root })).rejects.toMatchObject({
      kind: "invalid_request",
    });
  });

  it("requires a schema-valid evidence record tied to the snapshot", async () => {
    const root = await fixtureRoot();
    await writeSnapshot(root, { aoiId: "evidence_aoi", state: "ready" });
    await expect(
      getRuntimeAcquisitionEvidence("evidence_aoi", { cacheRoot: root }),
    ).rejects.toMatchObject({ kind: "not_found" });
    await writeFile(
      path.join(root, "evidence_aoi", "acquisition_evidence.json"),
      JSON.stringify({
        evidence_version: "provider_runtime_acquisition_evidence/v1",
        aoi_id: "evidence_aoi",
        snapshot_id: "evidence_aoi",
        resolved_geometry: {
          type: "Polygon",
          coordinates: [
            [
              [18.4, 50],
              [18.6, 50],
              [18.6, 50.2],
              [18.4, 50],
            ],
          ],
        },
        allowed_domains: ["power"],
        source_observed_at: "2026-08-31T10:00:00Z",
        overpass_endpoint: null,
        pipeline_version: "fixture/v1",
        published_at: "2026-08-31T10:00:01Z",
        domains: [
          {
            domain: "power",
            preparation_duration_ms: 12,
            queried_feature_count: 3,
            accepted_feature_count: 2,
            rejected_feature_count: 1,
            validation_status: "passed",
            limitations: [],
            overpass_endpoint: null,
          },
        ],
      }),
    );
    await expect(
      getRuntimeAcquisitionEvidence("evidence_aoi", { cacheRoot: root }),
    ).resolves.toMatchObject({ aoi_id: "evidence_aoi" });
  });
});

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "mdq-prepared-snapshot-"));
  roots.push(root);
  return root;
}

async function writeSnapshot(
  root: string,
  options: { aoiId: string; state: "ready" | "queued" | "failed" },
): Promise<void> {
  const snapshotRoot = path.join(root, options.aoiId);
  const isReady = options.state !== "failed";
  const domainManifest = Buffer.from('{"domain_pack_version":"provider_domain_pack/v2"}');
  if (isReady) {
    const domainRoot = path.join(snapshotRoot, "power", "domain-pack-v2");
    await mkdir(domainRoot, { recursive: true });
    await writeFile(path.join(domainRoot, "manifest.json"), domainManifest);
  } else {
    await mkdir(snapshotRoot, { recursive: true });
  }
  const unsigned = {
    snapshot_version: "provider_prepared_snapshot/v1",
    snapshot_id: options.aoiId,
    aoi_id: options.aoiId,
    version: "fixture-v1",
    state: options.state,
    published_at: options.state === "queued" ? null : "2026-08-31T10:00:00Z",
    source_observed_at: options.state === "queued" ? null : "2026-08-31T10:00:00Z",
    pipeline_version: "fixture/v1",
    coverage: {
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [18.4, 50],
            [18.6, 50],
            [18.6, 50.2],
            [18.4, 50],
          ],
        ],
      },
      geometry_crs: "EPSG:4326",
      input_type: "circle",
      source_label: "Fixture circle",
      limitations: ["Fixture source-dated evidence."],
    },
    domain_outcomes: [
      {
        domain: "power",
        status: isReady ? "ready" : "failed",
        detail: "Fixture domain",
        manifest_sha256: isReady ? createHash("sha256").update(domainManifest).digest("hex") : null,
        readiness: isReady ? "ready" : "not_usable",
        limitations: [],
      },
    ],
  };
  await writeFile(
    path.join(snapshotRoot, "snapshot_manifest.json"),
    JSON.stringify({ ...unsigned, checksum: digest(unsigned) }),
  );
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
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
