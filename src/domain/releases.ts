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
  channel: z.enum(["released", "fixture"]), importedAt: z.iso.datetime(), reviewedAt: z.iso.datetime().nullable(),
  sources: z.array(SourceSnapshotSchema).min(1), previousReleaseId: z.string().min(1).nullable(),
});
export type DataRelease = z.infer<typeof DataReleaseSchema>;

export const ReleaseIndexSchema = z.strictObject({
  currentReleaseId: z.string().min(1).nullable(),
  releases: z.array(DataReleaseSchema).min(1),
}).superRefine((index, context) => {
  const releaseIds = new Set<string>();
  for (const [releaseIndex, release] of index.releases.entries()) {
    if (releaseIds.has(release.id)) {
      context.addIssue({
        code: "custom",
        path: ["releases", releaseIndex, "id"],
        message: `duplicate release id: ${release.id}`,
      });
    }
    releaseIds.add(release.id);
  }

  if (index.currentReleaseId !== null && !releaseIds.has(index.currentReleaseId)) {
    context.addIssue({
      code: "custom",
      path: ["currentReleaseId"],
      message: `unknown current release id: ${index.currentReleaseId}`,
    });
  }
  for (const [releaseIndex, release] of index.releases.entries()) {
    if (release.previousReleaseId !== null && !releaseIds.has(release.previousReleaseId)) {
      context.addIssue({
        code: "custom",
        path: ["releases", releaseIndex, "previousReleaseId"],
        message: `unknown previous release id: ${release.previousReleaseId}`,
      });
    }
  }
});
export type ReleaseIndex = z.infer<typeof ReleaseIndexSchema>;

export const ReleaseEntitiesSchema = z.strictObject({
  characters: z.array(CharacterRevisionSchema), equipment: z.array(EquipmentRevisionSchema),
  effects: z.array(EffectSchema),
});
export type ReleaseEntities = z.infer<typeof ReleaseEntitiesSchema>;

export function collectRevisionIdentities(entities: ReleaseEntities) {
  return [
    ...entities.characters,
    ...entities.equipment,
    ...entities.characters.flatMap((character) => [
      ...character.abilities,
      ...character.traces,
      ...character.eidolons,
    ]),
  ];
}

export const GameReleaseBundleSchema = z.strictObject({
  release: DataReleaseSchema, entities: ReleaseEntitiesSchema,
}).superRefine((bundle, context) => {
  const revisionIds = new Set<string>();
  for (const revision of collectRevisionIdentities(bundle.entities)) {
    if (revisionIds.has(revision.revisionId)) {
      context.addIssue({
        code: "custom",
        path: ["entities"],
        message: `duplicate revisionId: ${revision.revisionId}`,
      });
    }
    revisionIds.add(revision.revisionId);
  }

  const effectIds = new Set<string>();
  for (const effect of bundle.entities.effects) {
    if (effectIds.has(effect.id)) {
      context.addIssue({
        code: "custom",
        path: ["entities", "effects"],
        message: `duplicate effect id: ${effect.id}`,
      });
    }
    effectIds.add(effect.id);
  }

  const effectSources = [
    ...bundle.entities.equipment,
    ...bundle.entities.characters.flatMap((character) => [
      ...character.abilities,
      ...character.traces,
      ...character.eidolons,
    ]),
  ];
  const sourceRevisionIds = new Set(effectSources.map((source) => source.revisionId));
  for (const source of effectSources) {
    const declared = [...source.effectIds].sort();
    const owned = bundle.entities.effects
      .filter((effect) => effect.sourceRevisionId === source.revisionId)
      .map((effect) => effect.id)
      .sort();
    if (JSON.stringify(declared) !== JSON.stringify(owned)) {
      context.addIssue({
        code: "custom",
        path: ["entities"],
        message: `effect ownership mismatch for ${source.revisionId}`,
      });
    }
  }

  for (const effect of bundle.entities.effects) {
    if (!sourceRevisionIds.has(effect.sourceRevisionId)) {
      context.addIssue({
        code: "custom",
        path: ["entities", "effects"],
        message: `dangling sourceRevisionId ${effect.sourceRevisionId} from ${effect.id}`,
      });
    }
  }
});
export type GameReleaseBundle = z.infer<typeof GameReleaseBundleSchema>;
