import { z } from "zod";

export const TeamPresetSchema = z.strictObject({
  id: z.string().min(1), releaseId: z.string().min(1),
  slots: z.tuple([z.string().min(1), z.string().min(1), z.string().min(1), z.string().min(1)]),
  substitutions: z.array(z.strictObject({ slot: z.number().int().min(0).max(3), characterLogicalId: z.string().min(1) })),
  requirements: z.array(z.string().min(1)), tags: z.array(z.string().min(1)), summary: z.string().min(1),
  source: z.strictObject({
    url: z.url(), author: z.string().min(1), publishedAt: z.iso.datetime(),
    retrievedAt: z.iso.datetime(), availability: z.enum(["available", "unavailable"]),
  }),
});
export type TeamPreset = z.infer<typeof TeamPresetSchema>;
