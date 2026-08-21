import { z } from "zod";

const boundedText = (max: number) => z.string().trim().min(1).max(max);
const LogicalIdSchema = boundedText(120);
const CharacterLogicalIdSchema = LogicalIdSchema.regex(/^character:/, "expected character logical ID");
const LightConeLogicalIdSchema = LogicalIdSchema.regex(/^light-cone:/, "expected light-cone logical ID");
const HttpsUrlSchema = z.url().refine((value) => new URL(value).protocol === "https:", "source URL must use HTTPS");

export const CommunityPublicationSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("published"), publishedAt: z.iso.datetime() }),
  z.strictObject({ status: z.literal("unknown"), reason: boundedText(200) }),
]);

export const CommunitySourceSchema = z.strictObject({
  url: HttpsUrlSchema, title: boundedText(200), author: boundedText(120), publisher: boundedText(120),
  publication: CommunityPublicationSchema, retrievedAt: z.iso.datetime(),
  availability: z.enum(["available", "unavailable"]),
});

export const CommunitySubstitutionSchema = z.strictObject({
  slot: z.number().int().min(0).max(3), characterLogicalId: CharacterLogicalIdSchema, note: boundedText(200),
});

export const CommunityMemberAssumptionSchema = z.strictObject({
  eidolon: z.number().int().min(0).max(6),
  equipment: z.discriminatedUnion("status", [
    z.strictObject({
      status: z.literal("specified"), logicalId: LightConeLogicalIdSchema,
      superimposition: z.number().int().min(1).max(5),
    }),
    z.strictObject({ status: z.literal("none"), reason: boundedText(200) }),
  ]),
});

const RequirementsSchema = z.array(boundedText(200)).min(1).max(8).refine(
  (values) => new Set(values).size === values.length, "duplicate requirements are not allowed",
);
const TagsSchema = z.array(boundedText(40)).min(1).max(8).refine(
  (values) => new Set(values).size === values.length, "duplicate tags are not allowed",
);
const SubstitutionsSchema = z.array(CommunitySubstitutionSchema).max(8);
const MemberAssumptionsSchema = z.tuple([
  CommunityMemberAssumptionSchema, CommunityMemberAssumptionSchema,
  CommunityMemberAssumptionSchema, CommunityMemberAssumptionSchema,
]);

export const CommunityPresetReferenceSchema = z.strictObject({
  presetId: boundedText(120), investment: z.enum(["low", "moderate", "high"]),
  requirements: RequirementsSchema, substitutions: SubstitutionsSchema,
  memberAssumptions: MemberAssumptionsSchema,
});
export type CommunityPresetReference = z.infer<typeof CommunityPresetReferenceSchema>;

export const TeamPresetSchema = z.strictObject({
  id: boundedText(120), releaseId: boundedText(120), gameVersion: boundedText(40),
  channel: z.enum(["released", "fixture"]),
  slots: z.tuple([
    CharacterLogicalIdSchema, CharacterLogicalIdSchema, CharacterLogicalIdSchema, CharacterLogicalIdSchema,
  ]),
  memberAssumptions: MemberAssumptionsSchema,
  substitutions: SubstitutionsSchema, requirements: RequirementsSchema,
  investment: z.enum(["low", "moderate", "high"]), tags: TagsSchema,
  summary: boundedText(400), source: CommunitySourceSchema,
}).superRefine((preset, context) => {
  const primary = new Set(preset.slots);
  if (primary.size !== preset.slots.length) context.addIssue({
    code: "custom", path: ["slots"], message: "duplicate primary character logical IDs are not allowed",
  });
  const substitutes = new Set<string>();
  for (const [index, substitution] of preset.substitutions.entries()) {
    if (primary.has(substitution.characterLogicalId)) context.addIssue({
      code: "custom", path: ["substitutions", index, "characterLogicalId"],
      message: "substitution cannot duplicate a primary character",
    });
    if (substitutes.has(substitution.characterLogicalId)) context.addIssue({
      code: "custom", path: ["substitutions", index, "characterLogicalId"],
      message: "duplicate substitution character logical ID",
    });
    substitutes.add(substitution.characterLogicalId);
  }
});
export type TeamPreset = z.infer<typeof TeamPresetSchema>;

export const CommunityTeamLibrarySchema = z.strictObject({
  schemaVersion: z.literal(1), libraryKind: z.enum(["fixture-only", "mixed"]),
  currentReleaseId: boundedText(120).nullable(),
  presets: z.array(TeamPresetSchema),
}).superRefine((library, context) => {
  const presetIds = new Set<string>();
  for (const [index, preset] of library.presets.entries()) {
    if (presetIds.has(preset.id)) context.addIssue({
      code: "custom", path: ["presets", index, "id"],
      message: `duplicate community preset id: ${preset.id}`,
    });
    presetIds.add(preset.id);
  }
  if (library.libraryKind === "fixture-only" && (
    library.currentReleaseId !== null || library.presets.some((preset) => preset.channel !== "fixture")
  )) context.addIssue({
    code: "custom", path: ["libraryKind"],
    message: "fixture-only library requires null currentReleaseId and fixture presets only",
  });
  if (library.currentReleaseId !== null) {
    const currentPresets = library.presets.filter((preset) => preset.releaseId === library.currentReleaseId);
    if (!currentPresets.length || currentPresets.some((preset) => preset.channel !== "released")
      || !currentPresets.some((preset) => preset.source.availability === "available")) {
      context.addIssue({
        code: "custom", path: ["currentReleaseId"],
        message: "community current release must reference released, non-fixture presets",
      });
    }
  }
});
export type CommunityTeamLibrary = z.infer<typeof CommunityTeamLibrarySchema>;
