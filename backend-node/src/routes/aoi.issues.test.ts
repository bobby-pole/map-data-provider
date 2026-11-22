import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createApp } from "../app.js";
import { seedCompactRybnikCache } from "../test/fixtures.js";
import { issueListResponseSchema, providerErrorSchema } from "../types/provider.js";

describe("AOI issue evidence and review routes", () => {
  let temporaryDirectory: string;
  let reviewStorePath: string;
  let fixtureCacheDir: string;

  beforeAll(async () => {
    fixtureCacheDir = await mkdtemp(path.join(os.tmpdir(), "mdq-issues-cache-"));
    await seedCompactRybnikCache(fixtureCacheDir);
  });

  afterAll(async () => {
    await rm(fixtureCacheDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "mdq-issue-review-"));
    reviewStorePath = path.join(temporaryDirectory, "issue-reviews.json");
    await writeFile(
      reviewStorePath,
      '{"review_store_version":"provider_issue_reviews/v1","reviews":[]}\n',
    );
  });

  afterEach(async () => {
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  function appWithReviewStore() {
    return createApp({
      issueStorePaths: { reviewsPath: reviewStorePath },
      providerDataPaths: { cacheRoot: fixtureCacheDir },
    });
  }

  it("returns generated issue evidence with the initial open review state", async () => {
    const response = await request(appWithReviewStore()).get("/api/aoi/rybnik_35km/issues");

    expect(response.status).toBe(200);
    const issues = issueListResponseSchema.parse(response.body).issues;
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "DQ-MANUAL-SEEDS-NON-AUTHORITATIVE",
          rule_id: "manual.non_authoritative",
          review: { status: "open", note: null, created_at: null, updated_at: null },
        }),
      ]),
    );
  }, 15000);

  it("rejects a malformed AOI before reading issue storage", async () => {
    const response = await request(appWithReviewStore()).get("/api/aoi/Rybnik-35km/issues");

    expect(response.status).toBe(422);
    expect(providerErrorSchema.parse(response.body)).toMatchObject({ error: "invalid_request" });
  });

  it("persists a valid review across a new application instance", async () => {
    const update = await request(appWithReviewStore())
      .patch("/api/aoi/rybnik_35km/issues/DQ-MANUAL-SEEDS-NON-AUTHORITATIVE/review")
      .send({
        status: "acknowledged",
        note: "Reviewed as an intentional manual seed.",
        expected_updated_at: null,
      });

    expect(update.status).toBe(200);
    expect(update.body.review).toMatchObject({
      status: "acknowledged",
      note: "Reviewed as an intentional manual seed.",
    });
    const listed = await request(appWithReviewStore()).get("/api/aoi/rybnik_35km/issues");
    const issue = issueListResponseSchema
      .parse(listed.body)
      .issues.find((item) => item.id === update.body.id);
    expect(issue?.review).toEqual(update.body.review);
  });

  it("rejects malformed updates and invalid lifecycle transitions", async () => {
    const malformed = await request(appWithReviewStore())
      .patch("/api/aoi/rybnik_35km/issues/DQ-MANUAL-SEEDS-NON-AUTHORITATIVE/review")
      .send({ status: "invalid" });
    expect(malformed.status).toBe(422);
    expect(providerErrorSchema.parse(malformed.body)).toMatchObject({ error: "invalid_request" });

    const acknowledged = await request(appWithReviewStore())
      .patch("/api/aoi/rybnik_35km/issues/DQ-MANUAL-SEEDS-NON-AUTHORITATIVE/review")
      .send({ status: "acknowledged", expected_updated_at: null });
    const invalidTransition = await request(appWithReviewStore())
      .patch("/api/aoi/rybnik_35km/issues/DQ-MANUAL-SEEDS-NON-AUTHORITATIVE/review")
      .send({ status: "open", expected_updated_at: acknowledged.body.review.updated_at });
    expect(invalidTransition.status).toBe(422);
    expect(providerErrorSchema.parse(invalidTransition.body)).toMatchObject({
      error: "invalid_request",
    });
  });

  it("rejects stale review updates instead of overwriting them", async () => {
    const acknowledged = await request(appWithReviewStore())
      .patch("/api/aoi/rybnik_35km/issues/DQ-MANUAL-SEEDS-NON-AUTHORITATIVE/review")
      .send({ status: "acknowledged", expected_updated_at: null });
    const resolved = await request(appWithReviewStore())
      .patch("/api/aoi/rybnik_35km/issues/DQ-MANUAL-SEEDS-NON-AUTHORITATIVE/review")
      .send({ status: "resolved", expected_updated_at: acknowledged.body.review.updated_at });
    expect(resolved.status).toBe(200);

    const stale = await request(appWithReviewStore())
      .patch("/api/aoi/rybnik_35km/issues/DQ-MANUAL-SEEDS-NON-AUTHORITATIVE/review")
      .send({ status: "accepted", expected_updated_at: acknowledged.body.review.updated_at });
    expect(stale.status).toBe(409);
    expect(providerErrorSchema.parse(stale.body)).toMatchObject({ error: "conflict" });
  });

  it("serializes concurrent review writes so only one update can use a revision", async () => {
    const app = appWithReviewStore();
    const acknowledged = await request(app)
      .patch("/api/aoi/rybnik_35km/issues/DQ-MANUAL-SEEDS-NON-AUTHORITATIVE/review")
      .send({ status: "acknowledged", expected_updated_at: null });
    const expectedUpdatedAt = acknowledged.body.review.updated_at;

    const [accepted, ignored] = await Promise.all([
      request(app)
        .patch("/api/aoi/rybnik_35km/issues/DQ-MANUAL-SEEDS-NON-AUTHORITATIVE/review")
        .send({ status: "accepted", expected_updated_at: expectedUpdatedAt }),
      request(app)
        .patch("/api/aoi/rybnik_35km/issues/DQ-MANUAL-SEEDS-NON-AUTHORITATIVE/review")
        .send({ status: "ignored", expected_updated_at: expectedUpdatedAt }),
    ]);

    expect([accepted.status, ignored.status].sort()).toEqual([200, 409]);
  });

  it("does not attach a review when a regenerated issue identity changes", async () => {
    const update = await request(appWithReviewStore())
      .patch("/api/aoi/rybnik_35km/issues/DQ-MANUAL-SEEDS-NON-AUTHORITATIVE/review")
      .send({ status: "accepted", expected_updated_at: null });
    expect(update.status).toBe(200);

    const changedSnapshotPath = path.join(temporaryDirectory, "changed-issues.json");
    const originalSnapshot = JSON.parse(
      await readFile(path.resolve("../backend/data/issues/rybnik_35km.json"), "utf8"),
    ) as { issues: Array<Record<string, unknown>> };
    const changedIssue = originalSnapshot.issues[0];
    if (!changedIssue) {
      throw new Error("Expected the generated issue fixture to contain an issue.");
    }
    changedIssue.rule_version = "2.0";
    await writeFile(changedSnapshotPath, `${JSON.stringify(originalSnapshot)}\n`);
    const response = await request(
      createApp({
        issueStorePaths: { reviewsPath: reviewStorePath, generatedIssuesPath: changedSnapshotPath },
      }),
    ).get("/api/aoi/rybnik_35km/issues");
    const issue = issueListResponseSchema
      .parse(response.body)
      .issues.find((item) => item.id === "DQ-MANUAL-SEEDS-NON-AUTHORITATIVE");
    expect(issue?.review.status).toBe("open");
  });
});
