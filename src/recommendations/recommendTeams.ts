import { evaluateTeam, type TeamBuild, type TeamEvaluation, type TeamMemberBuild } from "../effects/evaluateTeam";
import { enumerateTeams, type ExcludedCandidate } from "./enumerateTeams";
import { explainRecommendation, type RecommendationExplanation } from "./explainRecommendation";
import { recommendationScenario, RecommendationCancelledError, type RecommendationContext, type RecommendationRequest } from "./request";
import {
  scoreTeam, WEIGHTS_VERSION, type CommunityReference, type ScoreComponents,
  type WeightedScoreComponents,
} from "./scoreTeam";

export interface RecommendationSubstitution {
  slot: number;
  replacing: string;
  replacement: string;
  resultingTeam: string[];
  scoreDelta: number;
  componentDeltas: Partial<ScoreComponents>;
}

export interface RecommendationResult {
  team: string[];
  build: TeamBuild;
  totalScore: number;
  components: ScoreComponents;
  weighted: WeightedScoreComponents;
  weightsVersion: typeof WEIGHTS_VERSION;
  evaluation: TeamEvaluation;
  explanation: RecommendationExplanation;
  substitutions: RecommendationSubstitution[];
  communityReferences: CommunityReference[];
  audit: {
    evaluatedCombinationCount: number;
    excluded: ExcludedCandidate[];
    truncated: boolean;
  };
}

function memberBuild(characterId: string, slot: number, request: RecommendationRequest, context: RecommendationContext): TeamMemberBuild {
  const configured = context.memberBuilds?.[characterId];
  const maxEidolon = Math.max(0, Math.min(request.investment?.maxEidolon ?? 6, 6));
  const lightCone = configured?.lightCone && (
    !request.investment?.allowedLightConeIds
    || request.investment.allowedLightConeIds.includes(configured.lightCone.logicalId)
  ) ? { ...configured.lightCone } : undefined;
  return {
    ...configured,
    slotId: `slot-${slot + 1}`,
    characterLogicalId: characterId,
    eidolon: Math.min(configured?.eidolon ?? 0, maxEidolon),
    lightCone,
    relicSets: configured?.relicSets?.filter((set) => !request.investment?.allowedRelicSetIds || request.investment.allowedRelicSetIds.includes(set.logicalId)).map((set) => ({ ...set })),
    consumableMetrics: configured?.consumableMetrics ? [...configured.consumableMetrics] : undefined,
  };
}

function changedComponents(first: ScoreComponents, second: ScoreComponents): Partial<ScoreComponents> {
  return Object.fromEntries((Object.keys(first) as Array<keyof ScoreComponents>).map((key) => (
    [key, Math.round((second[key] - first[key]) * 10_000) / 10_000]
  )).filter(([, value]) => value !== 0)) as Partial<ScoreComponents>;
}

export function recommendTeams(
  request: RecommendationRequest, context: RecommendationContext,
): RecommendationResult[] {
  if (context.signal?.aborted) throw new RecommendationCancelledError();
  const enumeration = enumerateTeams(request, context);
  const scenario = recommendationScenario(request, context);
  const scored = enumeration.teams.map((team) => {
    if (context.signal?.aborted) throw new RecommendationCancelledError();
    const build: TeamBuild = {
      releaseId: request.releaseId,
      members: team.map((characterId, slot) => memberBuild(characterId, slot, request, context)),
    };
    const evaluation = evaluateTeam(build, scenario, context.bundle);
    return { team, build, evaluation, ...scoreTeam(team, evaluation, request, context.bundle, context.communityPresets) };
  }).sort((left, right) => right.totalScore - left.totalScore
    || left.team.join("|").localeCompare(right.team.join("|")));
  const maxResults = Math.max(1, Math.min(request.maxResults ?? 3, 20));

  return scored.slice(0, maxResults).map((candidate) => {
    const substitutions = scored.filter((other) => {
      const changed = candidate.team.filter((id) => !other.team.includes(id));
      const added = other.team.filter((id) => !candidate.team.includes(id));
      return changed.length === 1 && added.length === 1;
    }).map((other): RecommendationSubstitution => {
      const slot = candidate.team.findIndex((id) => !other.team.includes(id));
      return {
        slot,
        replacing: candidate.team[slot],
        replacement: other.team.find((id) => !candidate.team.includes(id))!,
        resultingTeam: [...other.team],
        scoreDelta: Math.round((other.totalScore - candidate.totalScore) * 10_000) / 10_000,
        componentDeltas: changedComponents(candidate.components, other.components),
      };
    }).sort((left, right) => right.scoreDelta - left.scoreDelta
      || left.replacement.localeCompare(right.replacement)).slice(0, 3);
    return {
      team: [...candidate.team], build: candidate.build, totalScore: candidate.totalScore,
      components: candidate.components, weighted: candidate.weighted, weightsVersion: WEIGHTS_VERSION,
      evaluation: candidate.evaluation,
      explanation: explainRecommendation(candidate.team, candidate.components, candidate.evaluation),
      substitutions, communityReferences: candidate.communityReferences,
      audit: {
        evaluatedCombinationCount: enumeration.teams.length,
        excluded: enumeration.excluded.map((item) => ({ ...item, team: [...item.team] })),
        truncated: enumeration.truncated,
      },
    };
  });
}
