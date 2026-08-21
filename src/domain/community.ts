import { z } from "zod";

export const CommunitySourceSchema = z.strictObject({
  url: z.url(), title: z.string().min(1), author: z.string().min(1), publisher: z.string().min(1),
  publishedAt: z.iso.datetime().nullable(), retrievedAt: z.iso.datetime(),
  availability: z.enum(["available", "unavailable"]),
});

export const TeamPresetSchema = z.strictObject({
  id: z.string().min(1), releaseId: z.string().min(1), gameVersion: z.string().min(1),
  channel: z.enum(["released", "fixture"]),
  slots: z.tuple([z.string().min(1), z.string().min(1), z.string().min(1), z.string().min(1)]),
  substitutions: z.array(z.strictObject({
    slot: z.number().int().min(0).max(3), characterLogicalId: z.string().min(1), note: z.string().min(1),
  })),
  requirements: z.array(z.string().min(1)), investment: z.enum(["low", "moderate", "high"]),
  tags: z.array(z.string().min(1)), summary: z.string().min(1), source: CommunitySourceSchema,
});
export type TeamPreset = z.infer<typeof TeamPresetSchema>;

export const CommunityTeamLibrarySchema = z.strictObject({
  schemaVersion: z.literal(1), currentReleaseId: z.string().min(1).nullable(),
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
  if (library.currentReleaseId !== null) {
    const currentPresets = library.presets.filter((preset) => preset.releaseId === library.currentReleaseId);
    if (!currentPresets.length || currentPresets.some((preset) => preset.channel !== "released")) {
      context.addIssue({
        code: "custom", path: ["currentReleaseId"],
        message: "community current release must reference released, non-fixture presets",
      });
    }
  }
});
export type CommunityTeamLibrary = z.infer<typeof CommunityTeamLibrarySchema>;
