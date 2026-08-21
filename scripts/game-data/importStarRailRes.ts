import { z } from "zod";
import type { EntityProvenance, FeatureRevision } from "../../src/domain/entities";
import { GameReleaseBundleSchema, type GameReleaseBundle } from "../../src/domain/releases";
import type { FetchedSource, FetchedSourceFile } from "./fetchSource";

const CharacterSchema = z.object({
  id: z.union([z.string(), z.number()]), name: z.string().min(1), rarity: z.union([z.literal(4), z.literal(5)]),
  element: z.string().min(1), path: z.string().min(1), description: z.string().min(1),
});
const FeatureSchema = z.object({
  id: z.union([z.string(), z.number()]), characterId: z.union([z.string(), z.number()]),
  name: z.string().min(1), description: z.string().min(1),
});
const SkillSchema = FeatureSchema.extend({ type: z.string().min(1) });
const RankSchema = FeatureSchema.extend({ rank: z.number().int().positive() });
const LightConeSchema = z.object({
  id: z.union([z.string(), z.number()]), name: z.string().min(1), rarity: z.union([z.literal(3), z.literal(4), z.literal(5)]),
  path: z.string().min(1), description: z.string().min(1),
});
const LightConeRankSchema = z.object({
  lightConeId: z.union([z.string(), z.number()]), values: z.array(z.number().finite()),
});
const RelicSetSchema = z.object({
  id: z.union([z.string(), z.number()]), name: z.string().min(1), rarity: z.union([z.literal(3), z.literal(4), z.literal(5)]).nullable().optional(),
  description: z.string().min(1), setThresholds: z.array(z.number().int().positive()),
});

function file(source: FetchedSource, sourcePath: string): FetchedSourceFile {
  const found = source.files.get(sourcePath);
  if (!found) throw new Error(`required source path is missing: ${sourcePath}`);
  return found;
}

function provenance(input: FetchedSourceFile): EntityProvenance {
  return {
    sourceName: input.source.name,
    sourceUrl: input.source.baseUrl,
    sourceRevision: input.source.revision,
    sourcePath: input.path,
    sourceChecksum: input.checksum,
  };
}

function feature(
  item: z.infer<typeof FeatureSchema>, kind: string, prefix: string,
  releaseId: string, input: FetchedSourceFile,
): FeatureRevision {
  const id = String(item.id);
  return {
    logicalId: `${prefix}:${id}`,
    revisionId: `${prefix}:${id}@${releaseId}`,
    validFromReleaseId: releaseId,
    validToReleaseId: null,
    provenance: [provenance(input)],
    name: item.name,
    kind,
    originalText: item.description,
    effectIds: [],
    reviewStatus: "generated",
  };
}

export function importStarRailRes(source: FetchedSource): GameReleaseBundle {
  const releaseId = source.manifest.releaseId;
  const charactersFile = file(source, "index_new/cn/characters.json");
  const ranksFile = file(source, "index_new/cn/character_ranks.json");
  const skillsFile = file(source, "index_new/cn/character_skills.json");
  const tracesFile = file(source, "index_new/cn/character_skill_trees.json");
  const conesFile = file(source, "index_new/cn/light_cones.json");
  const coneRanksFile = file(source, "index_new/cn/light_cone_ranks.json");
  const relicsFile = file(source, "index_new/cn/relic_sets.json");

  const ranks = z.array(RankSchema).parse(ranksFile.value);
  const skills = z.array(SkillSchema).parse(skillsFile.value);
  const traces = z.array(SkillSchema).parse(tracesFile.value);
  const coneRanks = z.array(LightConeRankSchema).parse(coneRanksFile.value);

  const bundle = {
    release: {
      id: releaseId,
      gameVersion: source.manifest.gameVersion,
      region: "cn" as const,
      channel: "released" as const,
      importedAt: source.manifest.importedAt,
      reviewedAt: source.manifest.reviewedAt,
      sources: source.manifest.sources.map((entry) => ({
        name: entry.name,
        url: entry.baseUrl,
        revision: entry.revision,
        fileChecksums: entry.fileChecksums,
        retrievedAt: entry.retrievedAt,
      })),
      previousReleaseId: source.manifest.previousReleaseId,
    },
    entities: {
      characters: z.array(CharacterSchema).parse(charactersFile.value).map((item) => {
        const characterId = String(item.id);
        return {
          logicalId: `character:${characterId}`,
          revisionId: `character:${characterId}@${releaseId}`,
          validFromReleaseId: releaseId,
          validToReleaseId: null,
          provenance: [provenance(charactersFile)],
          name: item.name,
          rarity: item.rarity,
          element: item.element,
          path: item.path,
          description: item.description,
          reviewStatus: "generated" as const,
          abilities: skills.filter((entry) => String(entry.characterId) === characterId)
            .map((entry) => feature(entry, entry.type, "ability", releaseId, skillsFile)),
          traces: traces.filter((entry) => String(entry.characterId) === characterId)
            .map((entry) => feature(entry, entry.type, "trace", releaseId, tracesFile)),
          eidolons: ranks.filter((entry) => String(entry.characterId) === characterId)
            .map((entry) => feature(entry, `eidolon-${entry.rank}`, "eidolon", releaseId, ranksFile)),
        };
      }),
      equipment: [
        ...z.array(LightConeSchema).parse(conesFile.value).map((item) => {
          const id = String(item.id);
          const rank = coneRanks.find((entry) => String(entry.lightConeId) === id);
          return {
            logicalId: `light-cone:${id}`,
            revisionId: `light-cone:${id}@${releaseId}`,
            validFromReleaseId: releaseId,
            validToReleaseId: null,
            provenance: [provenance(conesFile), ...(rank ? [provenance(coneRanksFile)] : [])],
            kind: "light-cone" as const,
            name: item.name,
            rarity: item.rarity,
            description: item.description,
            pathRestriction: item.path,
            superimpositionValues: rank?.values ?? [],
            setThresholds: [],
            effectIds: [],
            reviewStatus: "generated" as const,
          };
        }),
        ...z.array(RelicSetSchema).parse(relicsFile.value).map((item) => {
          const id = String(item.id);
          return {
            logicalId: `relic-set:${id}`,
            revisionId: `relic-set:${id}@${releaseId}`,
            validFromReleaseId: releaseId,
            validToReleaseId: null,
            provenance: [provenance(relicsFile)],
            kind: "relic-set" as const,
            name: item.name,
            rarity: item.rarity ?? null,
            description: item.description,
            pathRestriction: null,
            superimpositionValues: [],
            setThresholds: item.setThresholds,
            effectIds: [],
            reviewStatus: "generated" as const,
          };
        }),
      ],
      effects: [],
    },
  };
  return GameReleaseBundleSchema.parse(bundle);
}
