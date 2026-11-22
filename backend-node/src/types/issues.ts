import { z } from "zod";

import { providerIdentifierSchema, sourceTypeSchema } from "./common.js";

export const issueReviewStatusSchema = z.enum([
  "open",
  "acknowledged",
  "resolved",
  "accepted",
  "ignored",
]);

export const generatedIssueSchema = z
  .object({
    id: z.string().min(1),
    rule_id: z.string().min(1),
    rule_version: z.string().min(1),
    severity: z.enum(["low", "medium", "high"]),
    source_type: sourceTypeSchema,
    domain: providerIdentifierSchema,
    layer_id: z.string().min(1),
    affected_object: z.object({ type: z.string().min(1), id: z.string().min(1) }).strict(),
    category: z.string().min(1),
    title: z.string().min(1),
    evidence: z.string().min(1),
    recommendation: z.string().min(1),
  })
  .strict();

export const generatedIssueSnapshotSchema = z
  .object({
    issue_snapshot_version: z.literal("provider_issues/v1"),
    aoi_id: providerIdentifierSchema,
    issues: z.array(generatedIssueSchema),
  })
  .strict();

export const issueReviewRecordSchema = z
  .object({
    aoi_id: providerIdentifierSchema,
    issue_id: z.string().min(1),
    rule_id: z.string().min(1),
    rule_version: z.string().min(1),
    layer_id: z.string().min(1),
    status: issueReviewStatusSchema.exclude(["open"]),
    note: z.string().max(1000).nullable(),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
  })
  .strict();

export const issueReviewStoreSchema = z
  .object({
    review_store_version: z.literal("provider_issue_reviews/v1"),
    reviews: z.array(issueReviewRecordSchema),
  })
  .strict();

export const issueReviewSchema = z
  .object({
    status: issueReviewStatusSchema,
    note: z.string().nullable(),
    created_at: z.string().datetime().nullable(),
    updated_at: z.string().datetime().nullable(),
  })
  .strict();

export const reviewedIssueSchema = generatedIssueSchema
  .extend({ review: issueReviewSchema })
  .strict();

export const issueListResponseSchema = z.object({
  aoi_id: providerIdentifierSchema,
  issues: z.array(reviewedIssueSchema),
});

export const issueReviewUpdateSchema = z
  .object({
    status: issueReviewStatusSchema.exclude(["open"]),
    note: z.string().trim().max(1000).nullable().optional(),
    expected_updated_at: z.string().datetime().nullable(),
  })
  .strict();

export type GeneratedIssue = z.infer<typeof generatedIssueSchema>;
export type IssueReviewRecord = z.infer<typeof issueReviewRecordSchema>;
export type IssueReviewUpdate = z.infer<typeof issueReviewUpdateSchema>;
export type ReviewedIssue = z.infer<typeof reviewedIssueSchema>;
