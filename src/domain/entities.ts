import { z } from "zod";
import { ReviewStatusSchema } from "./effects";

export const EntityKindSchema = z.enum(["character", "ability", "eidolon", "light-cone", "relic-set"]);
export type EntityKind = z.infer<typeof EntityKindSchema>;

export const EntityProvenanceSchema = z.strictObject({
  sourceName: z.string().min(1), sourceUrl: z.url(), sourceRevision: z.string().min(1),
  sourcePath: z.string().min(1), sourceChecksum: z.string().min(1),
});
export type EntityProvenance = z.infer<typeof EntityProvenanceSchema>;

export const CharacterRoleSchema = z.enum(["damage", "support", "sustain"]);
export type CharacterRole = z.infer<typeof CharacterRoleSchema>;
export const CharacterRoleAnnotationSchema = z.strictObject({
  releaseId: z.string().min(1),
  roles: z.array(CharacterRoleSchema).min(1).max(3)
    .refine((roles) => new Set(roles).size === roles.length, "duplicate character roles are not allowed"),
  reviewStatus: ReviewStatusSchema,
  provenance: z.array(EntityProvenanceSchema).min(1),
});
export type CharacterRoleAnnotation = z.infer<typeof CharacterRoleAnnotationSchema>;

export const RevisionIdentitySchema = z.strictObject({
  logicalId: z.string().min(1), revisionId: z.string().min(1),
  validFromReleaseId: z.string().min(1), validToReleaseId: z.string().min(1).nullable(),
  provenance: z.array(EntityProvenanceSchema).min(1),
});
export type RevisionIdentity = z.infer<typeof RevisionIdentitySchema>;

export const FeatureRevisionSchema = RevisionIdentitySchema.extend({
  name: z.string().min(1), kind: z.string().min(1), originalText: z.string().min(1),
  effectIds: z.array(z.string().min(1)), reviewStatus: ReviewStatusSchema,
});
export type FeatureRevision = z.infer<typeof FeatureRevisionSchema>;

export const CharacterRevisionSchema = RevisionIdentitySchema.extend({
  name: z.string().min(1), rarity: z.union([z.literal(4), z.literal(5)]),
  element: z.string().min(1), path: z.string().min(1), description: z.string().min(1),
  roleAnnotation: CharacterRoleAnnotationSchema,
  reviewStatus: ReviewStatusSchema, abilities: z.array(FeatureRevisionSchema),
  traces: z.array(FeatureRevisionSchema), eidolons: z.array(FeatureRevisionSchema),
});
export type CharacterRevision = z.infer<typeof CharacterRevisionSchema>;

export const EquipmentRevisionSchema = RevisionIdentitySchema.extend({
  kind: z.enum(["light-cone", "relic-set"]), name: z.string().min(1),
  rarity: z.union([z.literal(3), z.literal(4), z.literal(5)]).nullable(),
  description: z.string().min(1), pathRestriction: z.string().min(1).nullable(),
  superimpositionValues: z.array(z.number().finite()),
  setThresholds: z.array(z.number().int().positive()), effectIds: z.array(z.string().min(1)),
  reviewStatus: ReviewStatusSchema,
});
export type EquipmentRevision = z.infer<typeof EquipmentRevisionSchema>;
