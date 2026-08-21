import { z } from "zod";
import { CharacterRevisionSchema, EquipmentRevisionSchema } from "./entities";
import { EffectSchema } from "./effects";

export const SourceSnapshotSchema = z.strictObject({
  name: z.string().min(1), url: z.url(), revision: z.string().regex(/^[a-f0-9]{8,40}$/),
  fileChecksums: z.record(z.string().min(1), z.string().min(1)), retrievedAt: z.iso.datetime(),
});
export type SourceSnapshot = z.infer<typeof SourceSnapshotSchema>;

export const DataReleaseSchema = z.strictObject({
  id: z.string().min(1), gameVersion: z.string().min(1), region: z.literal("cn"),
  channel: z.literal("released"), importedAt: z.iso.datetime(), reviewedAt: z.iso.datetime().nullable(),
  sources: z.array(SourceSnapshotSchema).min(1), previousReleaseId: z.string().min(1).nullable(),
});
export type DataRelease = z.infer<typeof DataReleaseSchema>;

export const ReleaseIndexSchema = z.strictObject({
  currentReleaseId: z.string().min(1), releases: z.array(DataReleaseSchema).min(1),
});
export type ReleaseIndex = z.infer<typeof ReleaseIndexSchema>;

export const ReleaseEntitiesSchema = z.strictObject({
  characters: z.array(CharacterRevisionSchema), equipment: z.array(EquipmentRevisionSchema),
  effects: z.array(EffectSchema),
});
export type ReleaseEntities = z.infer<typeof ReleaseEntitiesSchema>;

export const GameReleaseBundleSchema = z.strictObject({
  release: DataReleaseSchema, entities: ReleaseEntitiesSchema,
});
export type GameReleaseBundle = z.infer<typeof GameReleaseBundleSchema>;
