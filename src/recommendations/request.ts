import type { TeamPreset } from "../domain/community";
import type { GameReleaseBundle } from "../domain/releases";
import type { BattleScenario, TeamMemberBuild } from "../effects/evaluateTeam";

export type RecommendationObjective = "comfort" | "low-investment" | "maximum-synergy";
export type EncounterMode = "standard" | "break" | "follow-up" | "damage-over-time";

export interface RecommendationRequest {
  releaseId: string;
  roster: { mode: "unrestricted" } | { mode: "owned-only"; characterIds: string[] };
  requiredCharacterIds: string[];
  excludedCharacterIds: string[];
  encounter: { mode: EncounterMode; enemyWeaknesses: string[]; enemyBroken?: boolean };
  objective: RecommendationObjective;
  archetype?: string;
  desiredDamageDealerId?: string;
  investment?: {
    maxEidolon?: number;
    allowedLightConeIds?: string[];
    allowedRelicSetIds?: string[];
  };
  maxResults?: number;
  maxCombinations?: number;
}

export interface RecommendationContext {
  bundle: GameReleaseBundle;
  communityPresets: TeamPreset[];
  communityPresetValidator?: (preset: TeamPreset, bundle: GameReleaseBundle) => string[];
  memberBuilds?: Record<string, Omit<TeamMemberBuild, "characterLogicalId" | "slotId">>;
  scenario?: BattleScenario;
  signal?: AbortSignal;
}

export interface ConstraintIssue {
  code: "release_mismatch" | "unknown_character" | "required_excluded_conflict"
    | "required_not_owned" | "too_many_required" | "insufficient_roster" | "no_legal_team"
    | "community_library_too_large";
  message: string;
  characterId?: string;
  availableCount?: number;
  requiredCount?: number;
}

export class RecommendationConstraintError extends Error {
  readonly issues: ConstraintIssue[];

  constructor(issues: ConstraintIssue[]) {
    const ordered = [...issues].sort((left, right) => (
      `${left.code}:${left.characterId ?? ""}:${left.message}`
        .localeCompare(`${right.code}:${right.characterId ?? ""}:${right.message}`)
    ));
    super(ordered.map(({ message }) => message).join("；"));
    this.name = "RecommendationConstraintError";
    this.issues = ordered;
  }
}

export class RecommendationCancelledError extends Error {
  constructor() {
    super("recommendation cancelled");
    this.name = "RecommendationCancelledError";
  }
}

export interface NaturalLanguageResult { team: readonly string[]; totalScore: number; explanation: { summary: string; evidenceIds: readonly string[] } }

export interface NaturalLanguageAdapter {
  parse(input: string, base: RecommendationRequest): Promise<RecommendationRequest>;
  verbalize(results: readonly NaturalLanguageResult[]): Promise<string>;
}

export function stableUnique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort();
}

export function recommendationScenario(request: RecommendationRequest, context: RecommendationContext): BattleScenario {
  const events = request.encounter.mode === "follow-up" ? ["follow-up"]
    : request.encounter.mode === "damage-over-time" ? ["damage-over-time"] : [];
  return {
    ...context.scenario,
    enemyBroken: request.encounter.enemyBroken ?? request.encounter.mode === "break",
    enemyWeaknesses: stableUnique(request.encounter.enemyWeaknesses),
    activeEvents: stableUnique([...(context.scenario?.activeEvents ?? []), ...events]),
    firedThisEvaluation: events.length ? { events } : context.scenario?.firedThisEvaluation,
  };
}
