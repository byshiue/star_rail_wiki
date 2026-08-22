import { validatePresetForBundle } from "../community/teamRepository";
import { MAX_COMMUNITY_TEAM_PRESETS, type TeamPreset } from "../domain/community";
import type { CharacterRevision } from "../domain/entities";
import type { GameReleaseBundle } from "../domain/releases";
import type { TeamBuild, TeamEvaluation } from "../effects/evaluateTeam";
import { characterRoles } from "./enumerateTeams";
import {
  RecommendationCancelledError, RecommendationConstraintError,
  type RecommendationContext, type RecommendationRequest,
} from "./request";

export const WEIGHTS_VERSION = "recommendation-weights-v2" as const;
export const COMMUNITY_PRIOR_WEIGHT_CAP = 5;
export const MAX_COMMUNITY_PRESETS = MAX_COMMUNITY_TEAM_PRESETS;

export interface ScoreComponents {
  roleCoverage: number;
  buffApplicability: number;
  mechanicSynergy: number;
  skillPointEconomy: number;
  actionCompatibility: number;
  weaknessCoverage: number;
  survivability: number;
  activationCost: number;
  wastedEffects: number;
  communityPrior: number;
}

export type WeightedScoreComponents = ScoreComponents;
export type ScoreWeights = Record<keyof ScoreComponents, number>;

export const SCORE_WEIGHTS: ScoreWeights = {
  roleCoverage: 24,
  buffApplicability: 18,
  mechanicSynergy: 12,
  skillPointEconomy: 8,
  actionCompatibility: 7,
  weaknessCoverage: 10,
  survivability: 14,
  activationCost: -8,
  wastedEffects: -10,
  communityPrior: 5,
};

export function weightsForRequest(request: RecommendationRequest): ScoreWeights {
  if (request.objective === "low-investment") return { ...SCORE_WEIGHTS, activationCost: -16, communityPrior: 3 };
  if (request.objective === "comfort") return { ...SCORE_WEIGHTS, survivability: 20 };
  return { ...SCORE_WEIGHTS };
}

export interface CommunityReference {
  presetId: string;
  sourceUrl: string;
  author: string;
  publisher: string;
  publication: string;
  retrievedAt: string;
  availability: TeamPreset["source"]["availability"];
  overlapCount: number;
  boundedContribution: number;
  eligibilityIssues: string[];
}

export interface PreparedCommunityPreset {
  preset: TeamPreset;
  baseEligibilityIssues: string[];
}

export interface ScoredTeam {
  components: ScoreComponents;
  weighted: WeightedScoreComponents;
  totalScore: number;
  communityReferences: CommunityReference[];
}

export interface RecommendationInstrumentation { onCommunityPresetValidated?: (preset: TeamPreset) => void }

function rounded(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function clamped01(value: number): number {
  return Math.max(0, Math.min(1, rounded(value)));
}

function teamCharacters(team: readonly string[], bundle: GameReleaseBundle): CharacterRevision[] {
  const ids = new Set(team);
  return bundle.entities.characters.filter((character) => (
    character.validToReleaseId === null && ids.has(character.logicalId)
  )).sort((left, right) => left.logicalId.localeCompare(right.logicalId));
}

function baseCommunityEligibility(
  preset: TeamPreset, request: RecommendationRequest, context: RecommendationContext,
): string[] {
  const issues = validatePresetForBundle(preset, context.bundle);
  const excluded = new Set(request.excludedCharacterIds);
  const owned = request.roster.mode === "owned-only" ? new Set(request.roster.characterIds) : null;
  if (preset.slots.some((id) => excluded.has(id))) issues.push("preset contains an excluded character");
  if (owned && preset.slots.some((id) => !owned.has(id))) issues.push("preset contains an unowned character");
  if (request.objective === "low-investment" && preset.investment !== "low") issues.push("preset is not low investment");
  for (const assumption of preset.memberAssumptions) {
    if (request.investment?.maxEidolon !== undefined && assumption.eidolon > request.investment.maxEidolon) {
      issues.push("preset exceeds max eidolon");
    }
    if (assumption.equipment.status === "specified" && request.investment?.allowedLightConeIds
      && !request.investment.allowedLightConeIds.includes(assumption.equipment.logicalId)) {
      issues.push("preset uses a disallowed light cone");
    }
  }
  return [...new Set(issues)].sort();
}

export function prepareCommunityPresets(
  request: RecommendationRequest, context: RecommendationContext,
  instrumentation?: RecommendationInstrumentation,
): PreparedCommunityPreset[] {
  if (context.communityPresets.length > MAX_COMMUNITY_PRESETS) {
    throw new RecommendationConstraintError([{
      code: "community_library_too_large",
      message: `社区配队资料最多允许 ${MAX_COMMUNITY_PRESETS} 条；当前为 ${context.communityPresets.length} 条`,
    }]);
  }
  const relevant = [...context.communityPresets]
    .filter(({ releaseId }) => releaseId === request.releaseId)
    .sort((left, right) => left.id.localeCompare(right.id));
  return relevant.map((preset, index) => {
    if ((index & 31) === 0 && context.signal?.aborted) throw new RecommendationCancelledError();
    const prepared = { preset, baseEligibilityIssues: baseCommunityEligibility(preset, request, context) };
    instrumentation?.onCommunityPresetValidated?.(preset);
    return prepared;
  });
}

function assumptionIssues(preset: TeamPreset, build: TeamBuild): string[] {
  const members = new Map(build.members.map((member) => [member.characterLogicalId, member]));
  const issues: string[] = [];
  for (const [index, characterLogicalId] of preset.slots.entries()) {
    const member = members.get(characterLogicalId);
    if (!member) continue;
    const assumption = preset.memberAssumptions[index];
    if (member.characterLogicalId !== characterLogicalId) issues.push(`${characterLogicalId} character mismatch`);
    if (member.eidolon !== assumption.eidolon) issues.push(`${characterLogicalId} eidolon mismatch`);
    if (assumption.equipment.status === "none") {
      if (member.lightCone) issues.push(`${characterLogicalId} light cone mismatch`);
    } else if (!member.lightCone
      || member.lightCone.logicalId !== assumption.equipment.logicalId
      || member.lightCone.superimposition !== assumption.equipment.superimposition) {
      issues.push(`${characterLogicalId} light cone or superimposition mismatch`);
    }
    if (member.relicSets?.length) issues.push(`${characterLogicalId} relic sets are outside preset assumptions`);
    if (member.consumableMetrics?.length) issues.push(`${characterLogicalId} consumable metrics are outside preset assumptions`);
  }
  return issues.sort();
}

function communityEvidence(
  team: readonly string[], build: TeamBuild, prepared: readonly PreparedCommunityPreset[], signal?: AbortSignal,
): CommunityReference[] {
  const ids = new Set(team);
  return prepared.map(({ preset, baseEligibilityIssues }, index) => {
    if ((index & 31) === 0 && signal?.aborted) throw new RecommendationCancelledError();
    const overlapCount = preset.slots.filter((id) => ids.has(id)).length;
    const eligibilityIssues = overlapCount >= 3
      ? [...new Set([...baseEligibilityIssues, ...assumptionIssues(preset, build)])].sort()
      : baseEligibilityIssues;
    const boundedContribution = eligibilityIssues.length ? 0 : overlapCount === 4 ? 1 : overlapCount === 3 ? 0.5 : 0;
    return {
      presetId: preset.id, sourceUrl: preset.source.url, author: preset.source.author,
      publisher: preset.source.publisher,
      publication: preset.source.publication.status === "published"
        ? preset.source.publication.publishedAt : `unknown: ${preset.source.publication.reason}`,
      retrievedAt: preset.source.retrievedAt, availability: preset.source.availability,
      overlapCount, boundedContribution, eligibilityIssues,
    };
  }).filter(({ overlapCount }) => overlapCount >= 3)
    .sort((left, right) => right.boundedContribution - left.boundedContribution
      || left.presetId.localeCompare(right.presetId));
}

export function scoreTeam(
  team: readonly string[], build: TeamBuild, evaluation: TeamEvaluation, request: RecommendationRequest,
  context: RecommendationContext, preparedCommunity: readonly PreparedCommunityPreset[],
): ScoredTeam {
  const characters = teamCharacters(team, context.bundle);
  const roles = characters.flatMap(characterRoles);
  const relevant = evaluation.active.length + evaluation.conditional.length
    + evaluation.inactive.length + evaluation.wasted.length;
  const applicable = evaluation.active.length + evaluation.conditional.length;
  const references = communityEvidence(team, build, preparedCommunity, context.signal);
  const mechanicMetrics = request.encounter.mode === "break" ? new Set(["break_effect", "resistance_reduction"])
    : request.encounter.mode === "follow-up" ? new Set(["action_advance", "critical_damage"])
      : request.encounter.mode === "damage-over-time" ? new Set(["vulnerability", "effect_hit_rate"])
        : new Set(["damage_bonus", "attack"]);
  const mechanicMatches = evaluation.groups.filter(({ metric }) => mechanicMetrics.has(metric)).length;
  const weaknessSet = new Set(request.encounter.enemyWeaknesses.map((item) => item.toLowerCase()));
  const weaknessMatches = characters.filter(({ element }) => weaknessSet.has(element.toLowerCase())).length;
  const supportCount = roles.filter((role) => role === "support").length;
  const sustainCount = roles.filter((role) => role === "sustain").length;
  const damageCount = roles.filter((role) => role === "damage").length;
  const investmentCost = clamped01(team.reduce((total, characterId) => {
    const member = context.memberBuilds?.[characterId];
    return total + (member?.eidolon ?? 0) / 6 + (member?.lightCone ? 0.25 : 0)
      + Math.min(0.25, (member?.relicSets?.length ?? 0) * 0.1);
  }, 0) / team.length);
  const desiredDealer = request.desiredDamageDealerId ? team.includes(request.desiredDamageDealerId) : true;
  const components: ScoreComponents = {
    roleCoverage: clamped01((desiredDealer ? 0.4 : 0) + Math.min(1, damageCount) * 0.25
      + Math.min(1, supportCount) * 0.2 + Math.min(1, sustainCount) * 0.15),
    buffApplicability: relevant ? clamped01(applicable / relevant) : 0,
    mechanicSynergy: clamped01(mechanicMatches / 2),
    skillPointEconomy: clamped01((supportCount + sustainCount) / 3),
    actionCompatibility: evaluation.groups.some(({ metric }) => metric === "speed" || metric === "action_advance") ? 1 : 0.5,
    weaknessCoverage: request.encounter.enemyWeaknesses.length ? clamped01(weaknessMatches / 4) : 0.5,
    survivability: clamped01(sustainCount * (request.objective === "comfort" ? 1 : 0.8)),
    activationCost: clamped01(Math.max(relevant ? evaluation.inactive.length / relevant : 0, investmentCost)),
    wastedEffects: relevant ? clamped01(evaluation.wasted.length / relevant) : 0,
    communityPrior: references[0]?.boundedContribution ?? 0,
  };
  const appliedWeights = weightsForRequest(request);
  const weighted = Object.fromEntries(Object.entries(components).map(([key, value]) => (
    [key, rounded(value * appliedWeights[key as keyof ScoreComponents])]
  ))) as unknown as WeightedScoreComponents;
  const totalScore = rounded(Object.values(weighted).reduce((total, value) => total + value, 0));
  return { components, weighted, totalScore, communityReferences: references };
}
