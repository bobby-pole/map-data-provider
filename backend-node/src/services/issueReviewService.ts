import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  generatedIssueSnapshotSchema,
  issueReviewStoreSchema,
  type GeneratedIssue,
  type IssueReviewRecord,
  type IssueReviewUpdate,
  type ReviewedIssue,
} from "../types/provider.js";
import { ProviderDataError } from "./providerDataService.js";

const projectRoot = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const defaultIssueSnapshotPath = path.join(projectRoot, "backend", "data", "issues", "rybnik_60km.json");
const defaultReviewStorePath = path.join(projectRoot, "backend", "data", "reviews", "issue-reviews.json");
let reviewUpdateQueue: Promise<void> = Promise.resolve();

export type IssueStorePaths = {
  generatedIssuesPath?: string;
  reviewsPath?: string;
};

type ResolvedIssueStorePaths = Required<IssueStorePaths>;

const allowedTransitions: Record<IssueReviewRecord["status"] | "open", IssueReviewRecord["status"][]> = {
  open: ["acknowledged", "resolved", "accepted", "ignored"],
  acknowledged: ["resolved", "accepted", "ignored"],
  resolved: [],
  accepted: [],
  ignored: [],
};

export async function getReviewedIssues(aoiId: string, paths?: IssueStorePaths): Promise<ReviewedIssue[]> {
  validateAoiId(aoiId);
  const [snapshot, store] = await Promise.all([readIssueSnapshot(aoiId, paths), readReviewStore(paths)]);
  return snapshot.issues.map((issue) => mergeIssueReview(issue, aoiId, store.reviews));
}

export async function updateIssueReview(
  aoiId: string,
  issueId: string,
  update: IssueReviewUpdate,
  paths?: IssueStorePaths,
): Promise<ReviewedIssue> {
  return withReviewLock(() => updateIssueReviewLocked(aoiId, issueId, update, paths));
}

async function updateIssueReviewLocked(
  aoiId: string,
  issueId: string,
  update: IssueReviewUpdate,
  paths?: IssueStorePaths,
): Promise<ReviewedIssue> {
  validateAoiId(aoiId);
  const snapshot = await readIssueSnapshot(aoiId, paths);
  const issue = snapshot.issues.find((candidate) => candidate.id === issueId);
  if (!issue) throw new ProviderDataError("not_found", `No generated issue '${issueId}' exists for AOI '${aoiId}'.`);

  const resolvedPaths = resolvePaths(paths);
  const store = await readReviewStore(resolvedPaths);
  const existing = store.reviews.find((record) => identityMatches(record, issue, aoiId));
  const currentStatus = existing?.status ?? "open";
  if ((existing?.updated_at ?? null) !== update.expected_updated_at) {
    throw new ProviderDataError("conflict", "The review was updated by another request. Reload the issue before saving.");
  }
  if (!allowedTransitions[currentStatus].includes(update.status)) {
    throw new ProviderDataError("invalid_request", `Review transition '${currentStatus}' -> '${update.status}' is not allowed.`);
  }

  const now = nextTimestamp(existing?.updated_at);
  const record: IssueReviewRecord = {
    aoi_id: aoiId,
    issue_id: issue.id,
    rule_id: issue.rule_id,
    rule_version: issue.rule_version,
    layer_id: issue.layer_id,
    status: update.status,
    note: update.note === undefined ? existing?.note ?? null : update.note || null,
    created_at: existing?.created_at ?? now,
    updated_at: now,
  };
  await writeReviewStore({ review_store_version: "provider_issue_reviews/v1", reviews: replaceReview(store.reviews, existing, record) }, resolvedPaths);
  return { ...issue, review: reviewFromRecord(record) };
}

async function readIssueSnapshot(aoiId: string, paths?: IssueStorePaths) {
  const snapshot = generatedIssueSnapshotSchema.parse(await readJson(resolvePaths(paths).generatedIssuesPath, "generated issue snapshot"));
  if (snapshot.aoi_id !== aoiId) throw new ProviderDataError("not_found", `No generated issues exist for AOI '${aoiId}'.`);
  return snapshot;
}

async function readReviewStore(paths?: IssueStorePaths) {
  return issueReviewStoreSchema.parse(await readJson(resolvePaths(paths).reviewsPath, "issue review store"));
}

async function writeReviewStore(store: unknown, paths: ResolvedIssueStorePaths): Promise<void> {
  const content = `${JSON.stringify(issueReviewStoreSchema.parse(store), null, 2)}\n`;
  await mkdir(path.dirname(paths.reviewsPath), { recursive: true });
  const temporaryPath = `${paths.reviewsPath}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporaryPath, content, "utf8");
  await rename(temporaryPath, paths.reviewsPath);
}

function mergeIssueReview(issue: GeneratedIssue, aoiId: string, reviews: IssueReviewRecord[]): ReviewedIssue {
  const record = reviews.find((candidate) => identityMatches(candidate, issue, aoiId));
  return { ...issue, review: reviewFromRecord(record) };
}

function reviewFromRecord(record: IssueReviewRecord | undefined) {
  return record
    ? { status: record.status, note: record.note, created_at: record.created_at, updated_at: record.updated_at }
    : { status: "open" as const, note: null, created_at: null, updated_at: null };
}

function identityMatches(record: IssueReviewRecord, issue: GeneratedIssue, aoiId: string): boolean {
  return record.aoi_id === aoiId
    && record.issue_id === issue.id
    && record.rule_id === issue.rule_id
    && record.rule_version === issue.rule_version
    && record.layer_id === issue.layer_id;
}

function replaceReview(records: IssueReviewRecord[], existing: IssueReviewRecord | undefined, next: IssueReviewRecord): IssueReviewRecord[] {
  return existing ? records.map((record) => (record === existing ? next : record)) : [...records, next];
}

function nextTimestamp(previous: string | undefined): string {
  const previousMilliseconds = previous ? Date.parse(previous) : 0;
  return new Date(Math.max(Date.now(), previousMilliseconds + 1)).toISOString();
}

function withReviewLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = reviewUpdateQueue.then(operation, operation);
  reviewUpdateQueue = result.then(() => undefined, () => undefined);
  return result;
}

function resolvePaths(paths?: IssueStorePaths): ResolvedIssueStorePaths {
  return { generatedIssuesPath: paths?.generatedIssuesPath ?? defaultIssueSnapshotPath, reviewsPath: paths?.reviewsPath ?? defaultReviewStorePath };
}

function validateAoiId(aoiId: string): void {
  if (!/^[a-z0-9_]+$/.test(aoiId)) {
    throw new ProviderDataError("invalid_request", "AOI must use lowercase letters, digits and underscores only.");
  }
}

async function readJson(filePath: string, label: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as unknown;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      throw new ProviderDataError("not_found", `Missing ${label}.`);
    }
    throw error;
  }
}
