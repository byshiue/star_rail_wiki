import type { CharacterRevision, CharacterRole } from "../domain/entities";
import { RecommendationCancelledError, RecommendationConstraintError, stableUnique, type RecommendationContext, type RecommendationRequest } from "./request";

export interface ExcludedCandidate {
  team: string[];
  reason: "missing_damage_dealer" | "missing_sustain" | "combination_budget"
    | "invalid_build" | "investment_constraint";
  detail?: string;
}

export interface EnumerationResult {
  teams: string[][];
  excluded: ExcludedCandidate[];
  visitedCombinationCount: number;
  truncated: boolean;
}

export type { CharacterRole } from "../domain/entities";

export function characterRoles(character: CharacterRevision): readonly CharacterRole[] {
  return character.roleAnnotation.roles;
}

function validatePool(request: RecommendationRequest, context: RecommendationContext) {
  const activeCharacters = [...context.bundle.entities.characters]
    .filter(({ validToReleaseId }) => validToReleaseId === null)
    .sort((left, right) => left.logicalId.localeCompare(right.logicalId));
  const activeIds = new Set(activeCharacters.map(({ logicalId }) => logicalId));
  const required = stableUnique(request.requiredCharacterIds);
  const excluded = new Set(stableUnique(request.excludedCharacterIds));
  const owned = request.roster.mode === "owned-only" ? new Set(stableUnique(request.roster.characterIds)) : null;
  const issues = [];
  if (request.releaseId !== context.bundle.release.id) issues.push({
    code: "release_mismatch" as const,
    message: `请求版本 ${request.releaseId} 与资料版本 ${context.bundle.release.id} 不一致`,
  });
  for (const characterId of stableUnique([...required, ...excluded, ...(owned ? [...owned] : [])])) {
    if (!activeIds.has(characterId)) issues.push({
      code: "unknown_character" as const, characterId, message: `未知或非当前角色：${characterId}`,
    });
  }
  for (const characterId of required) {
    if (excluded.has(characterId)) issues.push({
      code: "required_excluded_conflict" as const, characterId,
      message: `角色同时被要求和排除：${characterId}`,
    });
    if (owned && !owned.has(characterId)) issues.push({
      code: "required_not_owned" as const, characterId, message: `必选角色不在已拥有列表：${characterId}`,
    });
  }
  if (required.length > 4) issues.push({ code: "too_many_required" as const, message: "必选角色不能超过 4 名" });
  if (issues.length) throw new RecommendationConstraintError(issues);
  const pool = activeCharacters.filter(({ logicalId }) => !excluded.has(logicalId) && (!owned || owned.has(logicalId)));
  if (pool.length < 4) throw new RecommendationConstraintError([{
    code: "insufficient_roster", availableCount: pool.length, requiredCount: 4,
    message: `至少需要 4 名合法角色；当前只有 ${pool.length} 名`,
  }]);
  return { pool, required: new Set(required) };
}

export function enumerateTeams(request: RecommendationRequest, context: RecommendationContext): EnumerationResult {
  if (context.signal?.aborted) throw new RecommendationCancelledError();
  const { pool, required } = validatePool(request, context);
  const characterById = new Map(pool.map((character) => [character.logicalId, character]));
  const maxCombinations = Math.max(1, Math.min(request.maxCombinations ?? 5_000, 50_000));
  const maxVisitedCombinations = Math.min(50_000, maxCombinations * 50);
  const teams: string[][] = [];
  const excluded: ExcludedCandidate[] = [];
  let visitedCombinationCount = 0;
  let truncated = false;

  outer: for (let a = 0; a < pool.length - 3; a += 1) {
    for (let b = a + 1; b < pool.length - 2; b += 1) {
      for (let c = b + 1; c < pool.length - 1; c += 1) {
        for (let d = c + 1; d < pool.length; d += 1) {
          if (context.signal?.aborted) throw new RecommendationCancelledError();
          if (visitedCombinationCount >= maxVisitedCombinations) {
            truncated = true;
            excluded.push({ team: [], reason: "combination_budget" });
            break outer;
          }
          visitedCombinationCount += 1;
          const team = [pool[a].logicalId, pool[b].logicalId, pool[c].logicalId, pool[d].logicalId];
          if ([...required].some((id) => !team.includes(id))) continue;
          const roles = team.flatMap((id) => characterRoles(characterById.get(id)!));
          if (!roles.includes("damage")) {
            excluded.push({ team, reason: "missing_damage_dealer" });
          } else if (!roles.includes("sustain")) {
            excluded.push({ team, reason: "missing_sustain" });
          } else {
            if (teams.length >= maxCombinations) {
              truncated = true;
              excluded.push({ team, reason: "combination_budget" });
              break outer;
            }
            teams.push(team);
          }
        }
      }
    }
  }
  if (!teams.length) throw new RecommendationConstraintError([{
    code: "no_legal_team", message: "约束下没有同时覆盖输出与生存职责的合法四人队伍",
  }]);
  return { teams, excluded, visitedCombinationCount, truncated };
}
