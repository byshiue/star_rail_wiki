import type { FeatureRevision } from "../../domain/entities";
import { GameReleaseBundleSchema } from "../../domain/releases";
import { fixtureBundle } from "../../effects/__fixtures__/goldenTeams";
import type { RecommendationContext } from "../request";

export function maxInvestmentFixture(): {
  bundle: ReturnType<typeof GameReleaseBundleSchema.parse>;
  memberBuilds: NonNullable<RecommendationContext["memberBuilds"]>;
} {
  const bundle = structuredClone(fixtureBundle);
  const featureTemplate = bundle.entities.characters
    .find(({ logicalId }) => logicalId === "character:synthetic-support")!.abilities[0]!;
  featureTemplate.effectIds = bundle.entities.effects
    .filter(({ sourceRevisionId }) => sourceRevisionId === featureTemplate.revisionId)
    .map(({ id }) => id);
  for (const character of bundle.entities.characters) {
    character.eidolons = Array.from({ length: 6 }, (_, index): FeatureRevision => ({
      ...structuredClone(featureTemplate),
      logicalId: `eidolon:${character.logicalId.slice("character:".length)}-${index + 1}`,
      revisionId: `eidolon:${character.logicalId.slice("character:".length)}-${index + 1}@4.3-fixture`,
      name: `${character.name}测试星魂 ${index + 1}`,
      kind: `eidolon-${index + 1}`,
      originalText: "仅用于最大投入推荐回归。",
      effectIds: [],
    }));
  }
  const cone = bundle.entities.equipment[0]!;
  bundle.entities.equipment.push({
    ...structuredClone(cone),
    logicalId: "relic-set:max-investment",
    revisionId: "relic-set:max-investment@4.3-fixture",
    kind: "relic-set",
    name: "最大投入测试遗器",
    pathRestriction: null,
    superimpositionValues: [],
    setThresholds: [2],
    effectIds: [],
  });
  const parsed = GameReleaseBundleSchema.parse(bundle);
  const memberBuilds: NonNullable<RecommendationContext["memberBuilds"]> = Object.fromEntries(
    parsed.entities.characters.map((character) => [character.logicalId, {
      eidolon: 6,
      relicSets: [{ logicalId: "relic-set:max-investment", pieces: 2 }],
      ...(character.logicalId === "character:synthetic-support" ? {
        lightCone: { logicalId: "light-cone:synthetic-cone", superimposition: 5 },
      } : {}),
    }]),
  );
  return { bundle: parsed, memberBuilds };
}
