import { z } from "zod";

export const OwnedCharacterSchema = z.strictObject({
  logicalId: z.string().min(1), eidolon: z.number().int().min(0).max(6), level: z.number().int().positive(),
});
export type OwnedCharacter = z.infer<typeof OwnedCharacterSchema>;

export const OwnedLightConeSchema = z.strictObject({
  instanceId: z.string().min(1).optional(), logicalId: z.string().min(1),
  superimposition: z.number().int().min(1).max(5), level: z.number().int().positive(),
});
export type OwnedLightCone = z.infer<typeof OwnedLightConeSchema>;

export const OwnedRelicSchema = z.strictObject({
  instanceId: z.string().min(1), setLogicalId: z.string().min(1), slot: z.string().min(1),
});
export type OwnedRelic = z.infer<typeof OwnedRelicSchema>;

export const InventorySourceSchema = z.strictObject({
  kind: z.literal("hsr-scanner"), build: z.string().min(1), formatVersion: z.number().int().positive(),
  importedAt: z.iso.datetime(),
  counts: z.strictObject({
    characters: z.number().int().nonnegative(), lightCones: z.number().int().nonnegative(),
    relics: z.number().int().nonnegative(),
  }),
});
export type InventorySource = z.infer<typeof InventorySourceSchema>;

export const AccountProfileSchema = z.strictObject({
  schemaVersion: z.number().int().positive(), uid: z.string().regex(/^\d{9}$/),
  label: z.string().min(1).optional(),
  region: z.enum(["cn", "asia", "america", "europe", "tw_hk_mo"]).optional(),
  dataReleaseId: z.string().min(1), updatedAt: z.iso.datetime(),
  characters: z.array(OwnedCharacterSchema), lightCones: z.array(OwnedLightConeSchema), relics: z.array(OwnedRelicSchema),
  inventorySources: z.array(InventorySourceSchema).max(100).optional(),
  publication: z.strictObject({ consentedAt: z.iso.datetime(), visibility: z.literal("public") }).optional(),
});
export type AccountProfile = z.infer<typeof AccountProfileSchema>;
