import type { TeamPreset } from "../domain/community";
import type { CharacterRevision } from "../domain/entities";
import type { GameReleaseBundle } from "../domain/releases";
import type { TeamEvaluation } from "../effects/evaluateTeam";
import { characterRole } from "./enumerateTeams";
import type { RecommendationRequest } from "./request";

export const WEIGHTS_VERSION = "recommendation-weights-v1" as const;
export const COMMUNITY_PRIOR_WEIGHT_CAP = 5;

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

export const SCORE_WEIGHTS: Omit<WeightedScoreComponents, "communityPrior"> = {
  roleCoverage: 24,
  buffApplicability: 18,
  mechanicSynergy: 12,
  skillPointEconomy: 8,
  actionCompatibility: 7,
  weaknessCoverage: 10,
  survivability: 14,
  activationCost: -8,
  wastedEffects: -10,
};

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
}

export interface ScoredTeam {
  components: ScoreComponents;
  weighted: WeightedScoreComponents;
  totalScore: number;
  communityReferences: CommunityReference[];
}

function rounded(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

function teamCharacters(team: readonly string[], bundle: GameReleaseBundle): CharacterRevision[] {
  const ids = new Set(team);
  return bundle.entities.characters.filter((character) => (
    character.validToReleaseId === null && ids.has(character.logicalId)
  )).sort((left, right) => left.logicalId.localeCompare(right.logicalId));
}

function communityEvidence(team: readonly string[], presets: readonly TeamPreset[], releaseId: string): CommunityReference[] {
  const ids = new Set(team);
  return presets.filter((preset) => preset.releaseId === releaseId).map((preset) => {
    const overlapCount = preset.slots.filter((id) => ids.has(id)).length;
    const boundedContribution = preset.source.availability !== "available" ? 0 : overlapCount === 4 ? 1 : overlapCount === 3 ? 0.5 : 0;
    return {
      presetId: preset.id,
      sourceUrl: preset.source.url,
      author: preset.source.author,
      publisher: preset.source.publisher,
      publication: preset.source.publication.status === "published"
        ? preset.source.publication.publishedAt : `unknown: ${preset.source.publication.reason}`,
      retrievedAt: preset.source.retrievedAt,
      availability: preset.source.availability,
      overlapCount,
      boundedContribution,
    };
  }).filter(({ overlapCount }) => overlapCount >= 3)
    .sort((left, right) => right.boundedContribution - left.boundedContribution
      || left.presetId.localeCompare(right.presetId));
}

export function scoreTeam(
  team: readonly string[], evaluation: TeamEvaluation, request: RecommendationRequest,
  bundle: GameReleaseBundle, presets: readonly TeamPreset[],
): ScoredTeam {
  const characters = teamCharacters(team, bundle);
  const roles = characters.map(characterRole);
  const relevant = evaluation.active.length + evaluation.conditional.length
    + evaluation.inactive.length + evaluation.wasted.length;
  const applicable = evaluation.active.length + evaluation.conditional.length;
  const references = communityEvidence(team, presets, request.releaseId);
  const archetype = `${request.archetype ?? ""} ${request.encounter.mode}`.toLowerCase();
  const mechanicMatches = characters.filter((character) => {
    const value = `${character.logicalId} ${character.path} ${character.name}`.toLowerCase();
    return archetype.split(/[\s-]+/).filter((part) => part.length > 2).some((part) => value.includes(part))
      || (request.encounter.mode === "break" && value.includes("break"));
  }).length;
  const weaknessSet = new Set(request.encounter.enemyWeaknesses.map((item) => item.toLowerCase()));
  const weaknessMatches = characters.filter(({ element }) => weaknessSet.has(element.toLowerCase())).length;
  const supportCount = roles.filter((role) => role === "support").length;
  const sustainCount = roles.filter((role) => role === "sustain").length;
  const damageCount = roles.filter((role) => role === "damage").length;
  const desiredDealer = request.desiredDamageDealerId ? team.includes(request.desiredDamageDealerId) : true;
  const components: ScoreComponents = {
    roleCoverage: rounded((desiredDealer ? 0.4 : 0) + Math.min(1, damageCount) * 0.25
      + Math.min(1, supportCount) * 0.2 + Math.min(1, sustainCount) * 0.15),
    buffApplicability: relevant ? rounded(applicable / relevant) : 0,
    mechanicSynergy: rounded(Math.min(1, mechanicMatches / 2)),
    skillPointEconomy: rounded(Math.min(1, (supportCount + sustainCount) / 3)),
    actionCompatibility: evaluation.groups.some(({ metric }) => metric === "speed" || metric === "action_advance") ? 1 : 0.5,
    weaknessCoverage: request.encounter.enemyWeaknesses.length ? rounded(weaknessMatches / 4) : 0.5,
    survivability: rounded(Math.min(1, sustainCount * (request.objective === "comfort" ? 1 : 0.8))),
    activationCost: relevant ? rounded(evaluation.inactive.length / relevant) : 0,
    wastedEffects: relevant ? rounded(evaluation.wasted.length / relevant) : 0,
    communityPrior: references[0]?.boundedContribution ?? 0,
  };
  const communityWeight = Math.min(COMMUNITY_PRIOR_WEIGHT_CAP,
    request.objective === "low-investment" ? 3 : COMMUNITY_PRIOR_WEIGHT_CAP);
  const weighted = Object.fromEntries(Object.entries(components).map(([key, value]) => {
    const weight = key === "communityPrior" ? communityWeight : SCORE_WEIGHTS[key as keyof typeof SCORE_WEIGHTS];
    return [key, rounded(value * weight)];
  })) as unknown as WeightedScoreComponents;
  const totalScore = rounded(Object.values(weighted).reduce((total, value) => total + value, 0));
  return { components, weighted, totalScore, communityReferences: references };
}
