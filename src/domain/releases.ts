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

function hasFixtureMarker(release: DataRelease): boolean {
  return /fixture/i.test(release.id) || release.sources.some((source) => (
    /fixture/i.test(source.name) || /fixture/i.test(source.url)
  ));
}

export const ReleaseIndexSchema = z.strictObject({
  currentReleaseId: z.string().min(1).nullable(),
  releases: z.array(DataReleaseSchema).min(1),
}).superRefine((index, context) => {
  const releaseIds = new Set<string>();
  for (const [releaseIndex, release] of index.releases.entries()) {
    if (release.channel === "released" && hasFixtureMarker(release)) {
      context.addIssue({
        code: "custom",
        path: ["releases", releaseIndex, "channel"],
        message: `fixture release cannot use released channel: ${release.id}`,
      });
    }

    if (releaseIds.has(release.id)) {
      context.addIssue({
        code: "custom",
        path: ["releases", releaseIndex, "id"],
        message: `duplicate release id: ${release.id}`,
      });
    }
    releaseIds.add(release.id);
  }

  if (index.currentReleaseId !== null) {
    const current = index.releases.find((release) => release.id === index.currentReleaseId);
    if (!current) {
      context.addIssue({
        code: "custom",
        path: ["currentReleaseId"],
        message: `unknown current release id: ${index.currentReleaseId}`,
      });
    } else if (current.channel !== "released" || hasFixtureMarker(current)) {
      context.addIssue({
        code: "custom",
        path: ["currentReleaseId"],
        message: `current release must reference a non-fixture released channel: ${current.id}`,
      });
    }
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

function collectKindedRevisionIdentities(entities: ReleaseEntities) {
  return [
    ...entities.characters.map((revision) => ({ kind: "character", revision })),
    ...entities.equipment.map((revision) => ({ kind: revision.kind, revision })),
    ...entities.characters.flatMap((character) => [
      ...character.abilities,
      ...character.traces,
      ...character.eidolons,
    ].map((revision) => ({ kind: revision.kind, revision }))),
  ];
}

export const GameReleaseBundleSchema = z.strictObject({
  release: DataReleaseSchema, entities: ReleaseEntitiesSchema,
}).superRefine((bundle, context) => {
  for (const [characterIndex, character] of bundle.entities.characters.entries()) {
    if (character.roleAnnotation.releaseId !== bundle.release.id) context.addIssue({
      code: "custom", path: ["entities", "characters", characterIndex, "roleAnnotation", "releaseId"],
      message: `role annotation release ${character.roleAnnotation.releaseId} does not match ${bundle.release.id}`,
    });
  }
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

  const canonicalGroups = new Map<string, Array<{ validToReleaseId: string | null }>>();
  for (const { kind, revision } of collectKindedRevisionIdentities(bundle.entities)) {
    const key = `${kind}:${revision.logicalId}`;
    const group = canonicalGroups.get(key) ?? [];
    group.push(revision);
    canonicalGroups.set(key, group);
  }
  for (const [key, revisions] of canonicalGroups) {
    const activeCount = revisions.filter((revision) => revision.validToReleaseId === null).length;
    if (activeCount !== 1) {
      context.addIssue({
        code: "custom",
        path: ["entities"],
        message: `canonical entity ${key} requires exactly one active revision; got ${activeCount}`,
      });
    }
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
