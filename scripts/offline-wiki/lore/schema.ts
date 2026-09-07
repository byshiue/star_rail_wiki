import { z } from "zod";
import { EntityProvenanceSchema } from "../../../src/domain/entities";

const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);

export const LoreFamilySchema = z.enum([
  "divergent-universe",
  "worldview",
  "mission",
  "collectible",
]);

export const LoreRelationshipTypeSchema = z.enum([
  "located-in",
  "member-of",
  "follows",
  "requires",
  "features",
  "mentions",
  "related-to",
]);

export const LoreRelationshipSchema = z.strictObject({
  type: LoreRelationshipTypeSchema,
  targetLogicalId: z.string().regex(/^(?:lore|character|light-cone|relic-set):/),
  external: z.boolean().default(false),
});

const LoreRecordCommonShape = {
  logicalId: z.string().regex(/^lore:/),
  name: z.string().min(1),
  aliases: z.array(z.string().min(1)),
  releaseId: z.string().min(1),
  locale: z.literal("zh-CN"),
  description: z.string().min(1),
  relationships: z.array(LoreRelationshipSchema),
  provenance: z.array(EntityProvenanceSchema).min(1),
  reviewStatus: z.literal("reviewed"),
  contentChecksum: Sha256Schema,
};

const DivergentUniverseMechanicsSchema = z.strictObject({
  rarity: z.number().int().positive().nullable(),
  path: z.string().min(1).nullable(),
  activationRequirement: z.string().min(1).nullable().optional(),
  enhancementRequirement: z.string().min(1).nullable().optional(),
  effect: z.string().min(1),
  enhancedEffect: z.string().min(1).nullable(),
});

const DivergentUniverseLoreSchema = z.strictObject({
  ...LoreRecordCommonShape,
  family: z.literal("divergent-universe"),
  kind: z.enum([
    "blessing",
    "equation",
    "curio",
    "weighted-curio",
    "occurrence",
    "tutorial",
    "probability-museum",
    "operational-record",
  ]),
  mechanics: DivergentUniverseMechanicsSchema.optional(),
});

const WorldviewLoreSchema = z.strictObject({
  ...LoreRecordCommonShape,
  family: z.literal("worldview"),
  kind: z.enum(["aeon", "path", "faction", "location", "term", "npc", "enemy"]),
});

const MissionLoreSchema = z.strictObject({
  ...LoreRecordCommonShape,
  family: z.literal("mission"),
  kind: z.enum(["trailblaze", "companion", "adventure", "permanent-event", "limited-event"]),
});

const CollectibleLoreSchema = z.strictObject({
  ...LoreRecordCommonShape,
  family: z.literal("collectible"),
  kind: z.enum(["readable", "inventory-item", "achievement", "message", "phonograph", "tutorial", "other"]),
});

export const LoreRecordSchema = z.discriminatedUnion("family", [
  DivergentUniverseLoreSchema,
  WorldviewLoreSchema,
  MissionLoreSchema,
  CollectibleLoreSchema,
]);

export const LoreBaselineSchema = z.strictObject({
  releaseId: z.string().min(1),
  family: LoreFamilySchema,
  baselineStatus: z.enum(["complete", "missing"]),
  expectedCount: z.number().int().nonnegative().nullable(),
  provenance: z.array(EntityProvenanceSchema),
  contentChecksum: Sha256Schema,
}).refine(
  ({ baselineStatus, expectedCount, provenance }) => (
    baselineStatus !== "complete" || (expectedCount !== null && provenance.length > 0)
  ),
  { message: "complete lore baselines require an expected count and provenance" },
);

export type LoreFamily = z.infer<typeof LoreFamilySchema>;
export type LoreRelationship = z.infer<typeof LoreRelationshipSchema>;
export type LoreRecord = z.infer<typeof LoreRecordSchema>;
export type LoreBaseline = z.infer<typeof LoreBaselineSchema>;
