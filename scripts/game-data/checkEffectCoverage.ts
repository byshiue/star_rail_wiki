import { z } from "zod";
import type { FeatureRevision, EquipmentRevision } from "../../src/domain/entities";
import type { Effect } from "../../src/domain/effects";
import type { ReleaseEntities } from "../../src/domain/releases";
import { extractCandidateEffects, type EffectSourceRevision } from "./extractEffects";

export const CoverageReportSchema = z.strictObject({
  totalSourceDescriptions: z.number().int().nonnegative(),
  candidateNumericEffects: z.number().int().nonnegative(),
  reviewedEffects: z.number().int().nonnegative(),
  generatedEffects: z.number().int().nonnegative(),
  explicitUnsupportedEffects: z.number().int().nonnegative(),
  unmappedEffects: z.number().int().nonnegative(),
});
export type CoverageReport = z.infer<typeof CoverageReportSchema>;

type EffectSources = readonly (FeatureRevision | EquipmentRevision | EffectSourceRevision)[];

export function collectEffectSources(entities: ReleaseEntities): Array<FeatureRevision | EquipmentRevision> {
  return [
    ...entities.equipment,
    ...entities.characters.flatMap((character) => [
      ...character.abilities,
      ...character.traces,
      ...character.eidolons,
    ]),
  ];
}

function sources(input: ReleaseEntities | EffectSources): EffectSources {
  return "characters" in input ? collectEffectSources(input) : input;
}

function coverageKey(value: { sourceRevisionId?: string; revisionId?: string; metric: string; originalText: string }): string {
  return `${value.sourceRevisionId ?? value.revisionId}\u0000${value.metric}\u0000${value.originalText}`;
}

export function buildCoverageReport(
  entities: ReleaseEntities | EffectSources,
  effects: readonly Effect[],
): CoverageReport {
  const sourceList = sources(entities);
  const candidates = sourceList.flatMap(extractCandidateEffects);
  const mappedCounts = new Map<string, number>();
  for (const effect of effects) {
    const key = coverageKey(effect);
    mappedCounts.set(key, (mappedCounts.get(key) ?? 0) + 1);
  }

  let unmappedEffects = 0;
  for (const candidate of candidates) {
    const key = coverageKey(candidate);
    const remaining = mappedCounts.get(key) ?? 0;
    if (remaining === 0) unmappedEffects += 1;
    else mappedCounts.set(key, remaining - 1);
  }

  return CoverageReportSchema.parse({
    totalSourceDescriptions: sourceList.length,
    candidateNumericEffects: candidates.length,
    reviewedEffects: effects.filter((effect) => effect.reviewStatus === "reviewed").length,
    generatedEffects: effects.filter((effect) => effect.reviewStatus === "generated").length,
    explicitUnsupportedEffects: effects.filter((effect) => effect.reviewStatus === "unsupported").length,
    unmappedEffects,
  });
}

export function assertComplete(report: CoverageReport): void {
  const parsed = CoverageReportSchema.parse(report);
  if (parsed.unmappedEffects !== 0) {
    throw new Error(`unmapped numeric effect count: ${parsed.unmappedEffects}`);
  }
}
