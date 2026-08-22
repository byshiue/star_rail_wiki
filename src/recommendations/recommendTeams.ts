import { evaluateTeam, type TeamBuild, type TeamEvaluation, type TeamMemberBuild } from "../effects/evaluateTeam";
import { validateTeamBuild } from "../simulator/teamBuild";
import { characterRoles, enumerateTeams, type CharacterRole, type ExcludedCandidate } from "./enumerateTeams";
import { explainRecommendation, type RecommendationExplanation } from "./explainRecommendation";
import { recommendationScenario, RecommendationCancelledError, RecommendationConstraintError, stableUnique, type RecommendationContext, type RecommendationRequest } from "./request";
import {
  scoreTeam, WEIGHTS_VERSION, type CommunityReference, type ScoreComponents,
  type ScoreWeights, type WeightedScoreComponents, weightsForRequest,
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
  appliedWeights: ScoreWeights;
  roles: Record<string, readonly CharacterRole[]>;
  requestSummary: { objective: RecommendationRequest["objective"]; encounter: RecommendationRequest["encounter"]; archetype?: string };
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

function memberBuild(characterId: string, slot: number, context: RecommendationContext): TeamMemberBuild {
  const configured = context.memberBuilds?.[characterId];
  return {
    ...configured,
    slotId: `slot-${slot + 1}`,
    characterLogicalId: characterId,
    eidolon: configured?.eidolon ?? 0,
    lightCone: configured?.lightCone ? { ...configured.lightCone } : undefined,
    relicSets: configured?.relicSets?.map((set) => ({ ...set })),
    consumableMetrics: configured?.consumableMetrics ? [...configured.consumableMetrics] : undefined,
  };
}

function investmentIssues(team: readonly string[], request: RecommendationRequest, context: RecommendationContext): string[] {
  const issues: string[] = [];
  for (const characterId of team) {
    const build = context.memberBuilds?.[characterId];
    if (!build) continue;
    if (request.investment?.maxEidolon !== undefined && (build.eidolon ?? 0) > request.investment.maxEidolon)
      issues.push(characterId + " exceeds max eidolon");
    if (build.lightCone && request.investment?.allowedLightConeIds
      && !request.investment.allowedLightConeIds.includes(build.lightCone.logicalId)) issues.push(characterId + " uses a disallowed light cone");
    for (const relic of build.relicSets ?? []) if (request.investment?.allowedRelicSetIds
      && !request.investment.allowedRelicSetIds.includes(relic.logicalId)) issues.push(characterId + " uses a disallowed relic set");
  }
  return issues.sort();
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
  const candidateExclusions: ExcludedCandidate[] = [];
  const scored: Array<{ team: string[]; build: TeamBuild; evaluation: TeamEvaluation; components: ScoreComponents; weighted: WeightedScoreComponents; totalScore: number; communityReferences: CommunityReference[] }> = [];
  for (const team of enumeration.teams) {
    if (context.signal?.aborted) throw new RecommendationCancelledError();
    const constraints = investmentIssues(team, request, context);
    if (constraints.length) {
      candidateExclusions.push({ team: [...team], reason: "investment_constraint", detail: constraints.join("; ") });
      continue;
    }
    const rawBuild: TeamBuild = { releaseId: request.releaseId, members: team.map((characterId, slot) => memberBuild(characterId, slot, context)) };
    let build: TeamBuild;
    try {
      build = validateTeamBuild(rawBuild, context.bundle);
    } catch (error) {
      candidateExclusions.push({ team: [...team], reason: "invalid_build", detail: error instanceof Error ? error.message : "invalid team build" });
      continue;
    }
    const evaluation = evaluateTeam(build, scenario, context.bundle);
    scored.push({ team, build, evaluation, ...scoreTeam(team, evaluation, request, context) });
  }
  scored.sort((left, right) => right.totalScore - left.totalScore || left.team.join("|").localeCompare(right.team.join("|")));
  if (!scored.length) throw new RecommendationConstraintError([{ code: "no_legal_team", message: "候选构筑均不满足装备或投入约束" }]);
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
      components: candidate.components, weighted: candidate.weighted, appliedWeights: weightsForRequest(request),
      roles: Object.fromEntries(candidate.team.map((id) => [id, characterRoles(context.bundle.entities.characters.find((character) => character.logicalId === id && character.validToReleaseId === null)!)])),
      requestSummary: { objective: request.objective, encounter: { ...request.encounter, enemyWeaknesses: stableUnique(request.encounter.enemyWeaknesses) }, archetype: request.archetype }, weightsVersion: WEIGHTS_VERSION,
      evaluation: candidate.evaluation,
      explanation: explainRecommendation(candidate.team, candidate.components, candidate.evaluation),
      substitutions, communityReferences: candidate.communityReferences,
      audit: {
        evaluatedCombinationCount: scored.length,
        excluded: [...enumeration.excluded, ...candidateExclusions].map((item) => ({ ...item, team: [...item.team] })),
        truncated: enumeration.truncated,
      },
    };
  });
}
