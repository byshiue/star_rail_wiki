import { createHash } from "node:crypto";
import { z } from "zod";
import { EntityProvenanceSchema } from "../../../src/domain/entities";
import { StoryEntityKindSchema, type ReviewedSummary } from "../schema";
import { parseReviewedSummary } from "../editorial";

export const DraftSummarySchema = z.strictObject({
  logicalId: z.string().min(1),
  entityKind: StoryEntityKindSchema,
  releaseId: z.string().min(1),
  locale: z.literal("zh-CN"),
  summary: z.string().min(1),
  reviewStatus: z.literal("draft"),
  provenance: z.array(EntityProvenanceSchema).min(1),
});

export type DraftSummary = z.infer<typeof DraftSummarySchema>;

export const ReviewDecisionSchema = z.strictObject({
  decision: z.enum(["accept", "reject"]),
  reviewer: z.string().min(1),
  reviewedAt: z.iso.datetime(),
  editedSummary: z.string().min(1).optional(),
});

export type ReviewDecision = z.infer<typeof ReviewDecisionSchema>;

export function promoteDraft(input: unknown, decisionInput: unknown): ReviewedSummary {
  const draft = DraftSummarySchema.parse(input);
  const decision = ReviewDecisionSchema.parse(decisionInput);
  if (decision.decision !== "accept") throw new Error("an explicit accept decision is required for promotion");
  const summary = decision.editedSummary ?? draft.summary;
  const contentChecksum = `sha256:${createHash("sha256").update(summary, "utf8").digest("hex")}`;
  return parseReviewedSummary({
    logicalId: draft.logicalId,
    entityKind: draft.entityKind,
    releaseId: draft.releaseId,
    locale: draft.locale,
    summary,
    contentChecksum,
    reviewStatus: "reviewed",
    reviewer: { name: decision.reviewer, reviewedAt: decision.reviewedAt },
    provenance: draft.provenance,
  });
}
