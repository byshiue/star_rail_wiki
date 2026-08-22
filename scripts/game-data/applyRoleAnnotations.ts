import { readFile } from "node:fs/promises";
import { z } from "zod";
import {
  CharacterRoleAnnotationSchema, type CharacterRevision,
} from "../../src/domain/entities";
import { GameReleaseBundleSchema, type GameReleaseBundle } from "../../src/domain/releases";

export const RoleAnnotationRecordSchema = CharacterRoleAnnotationSchema;
export const RoleAnnotationFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  annotations: z.array(RoleAnnotationRecordSchema).max(2_000),
});
export type RoleAnnotationRecord = z.infer<typeof RoleAnnotationRecordSchema>;
export type UnannotatedGameReleaseBundle = Omit<GameReleaseBundle, "entities"> & {
  entities: Omit<GameReleaseBundle["entities"], "characters"> & {
    characters: Array<Omit<CharacterRevision, "roleAnnotation">>;
  };
};

export async function loadRoleAnnotations(file = "data/manual/character-roles.json"): Promise<RoleAnnotationRecord[]> {
  return RoleAnnotationFileSchema.parse(JSON.parse(await readFile(file, "utf8"))).annotations;
}

function matchingAnnotations(
  releaseId: string, characterLogicalId: string, annotations: readonly RoleAnnotationRecord[],
): RoleAnnotationRecord[] {
  return annotations.filter((entry) => (
    entry.releaseId === releaseId && entry.characterLogicalId === characterLogicalId
  ));
}

export function applyRoleAnnotations(
  bundle: UnannotatedGameReleaseBundle, annotations: readonly RoleAnnotationRecord[],
): GameReleaseBundle {
  const characters = bundle.entities.characters.map((character) => {
    const matches = matchingAnnotations(bundle.release.id, character.logicalId, annotations);
    if (character.validToReleaseId === null && matches.length !== 1) {
      throw new Error(`active character ${character.logicalId} requires exactly one role annotation for ${bundle.release.id}; got ${matches.length}`);
    }
    if (matches.length !== 1) {
      throw new Error(`character ${character.logicalId} requires exactly one role annotation for ${bundle.release.id}; got ${matches.length}`);
    }
    return { ...character, roleAnnotation: structuredClone(matches[0]!) };
  });
  return GameReleaseBundleSchema.parse({ ...bundle, entities: { ...bundle.entities, characters } });
}

export function assertRoleAnnotations(
  bundle: GameReleaseBundle, annotations: readonly RoleAnnotationRecord[],
): void {
  for (const character of bundle.entities.characters.filter(({ validToReleaseId }) => validToReleaseId === null)) {
    const matches = matchingAnnotations(bundle.release.id, character.logicalId, annotations);
    if (matches.length !== 1) {
      throw new Error(`active character ${character.logicalId} requires exactly one role annotation for ${bundle.release.id}; got ${matches.length}`);
    }
    if (character.roleAnnotation.characterLogicalId !== character.logicalId) {
      throw new Error("role annotation character " + character.roleAnnotation.characterLogicalId + " does not match " + character.logicalId);
    }
    if (character.roleAnnotation.reviewStatus !== "reviewed") {
      throw new Error("active character " + character.logicalId + " requires a reviewed role annotation");
    }
    if (JSON.stringify(character.roleAnnotation) !== JSON.stringify(matches[0]!)) {
      throw new Error(`role annotation mismatch for ${character.logicalId} in ${bundle.release.id}`);
    }
  }
}
