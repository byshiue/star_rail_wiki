import type { Effect, EffectMetric, ReviewStatus } from "../domain/effects";
import type { EntityProvenance, FeatureRevision } from "../domain/entities";
import type { GameReleaseBundle } from "../domain/releases";

export interface TeamMemberBuild {
  characterLogicalId: string;
  eidolon: number;
  lightCone?: { logicalId: string; superimposition: number };
  relicSets?: Array<{ logicalId: string; pieces: number }>;
  consumableMetrics?: EffectMetric[];
}

export interface TeamBuild {
  releaseId: string;
  members: TeamMemberBuild[];
  effectLevels?: Record<string, number>;
}

export interface BattleScenario {
  enemyBroken?: boolean;
  enemyWeaknesses?: string[];
  battleStarted?: boolean;
  actionActive?: boolean;
  triggeredEvents?: string[];
  conditions?: Record<string, string | number | boolean>;
  stacks?: Record<string, number>;
  remainingTurns?: Record<string, number>;
  remainingActions?: Record<string, number>;
  targetAssignments?: Record<string, string>;
  enemies?: string[];
}

export type EvaluationReason =
  | "source_not_selected" | "eidolon_locked" | "illegal_equipment"
  | "review_not_approved" | "unsupported_effect"
  | "battle_not_started" | "action_not_active" | "event_not_triggered"
  | "duration_expired" | "target_required" | "target_not_selected"
  | "no_active_stacks" | "no_compatible_consumer"
  | "enemy_not_broken" | "condition_unknown" | "condition_not_met";

export interface EffectEvidence {
  id: string;
  effectId: string;
  sourceRevisionId: string;
  sourceLogicalId: string;
  sourceReviewStatus: ReviewStatus;
  releaseId: string;
  provenanceIds: string[];
  provenance: EntityProvenance[];
  originalText: string;
}

export interface EvaluatedEffect {
  effectId: string;
  sourceRevisionId: string;
  metric: Effect["metric"];
  operation: Effect["operation"];
  value: number;
  stacks: number;
  targets: string[];
  evidence: EffectEvidence;
}

export interface ExcludedEffect extends Omit<EvaluatedEffect, "value" | "stacks" | "targets"> {
  reason: EvaluationReason | string;
  value?: number;
  stacks?: number;
  targets?: string[];
}

export interface EvaluationWarning {
  code: "stack_cap_exceeded" | "metric_cap_exceeded" | "conflicting_overrides"
    | "target_mismatch" | "no_compatible_consumer" | "scaling_level_exceeded";
  effectId?: string;
  metric?: EffectMetric;
  message: string;
}

export interface MetricGroup {
  metric: EffectMetric;
  operations: Partial<Record<Effect["operation"], number>>;
  total: number | null;
  effectIds: string[];
  targets: string[];
}

export interface TeamEvaluation {
  active: EvaluatedEffect[];
  conditional: EvaluatedEffect[];
  inactive: ExcludedEffect[];
  unsupported: ExcludedEffect[];
  wasted: ExcludedEffect[];
  evidence: EffectEvidence[];
  groups: Partial<Record<EffectMetric, MetricGroup>>;
  warnings: EvaluationWarning[];
}

export interface SourceSelection {
  revision: FeatureRevision | GameReleaseBundle["entities"]["equipment"][number];
  member: TeamMemberBuild;
  legal: boolean;
  reason?: EvaluationReason;
  scalingLevel: number;
  setPieces?: number;
}

export interface EvaluationContext {
  build: TeamBuild;
  scenario: BattleScenario;
  bundle: GameReleaseBundle;
  sources: Map<string, SourceSelection>;
  relevantSourceIds: Set<string>;
  memberIds: Set<string>;
}

function addFeatureSources(
  sources: Map<string, SourceSelection>, relevant: Set<string>,
  features: FeatureRevision[], member: TeamMemberBuild, legal = true,
): void {
  for (const feature of features) {
    relevant.add(feature.revisionId);
    sources.set(feature.revisionId, {
      revision: feature, member, legal,
      reason: legal ? undefined : "eidolon_locked", scalingLevel: 1,
    });
  }
}

export function createEvaluationContext(
  build: TeamBuild, scenario: BattleScenario, bundle: GameReleaseBundle,
): EvaluationContext {
  if (build.releaseId !== bundle.release.id) {
    throw new Error(`team release ${build.releaseId} does not match bundle ${bundle.release.id}`);
  }

  const sources = new Map<string, SourceSelection>();
  const relevantSourceIds = new Set<string>();
  for (const member of build.members) {
    const character = bundle.entities.characters.find(({ logicalId }) => logicalId === member.characterLogicalId);
    if (!character) continue;
    addFeatureSources(sources, relevantSourceIds, character.abilities, member);
    addFeatureSources(sources, relevantSourceIds, character.traces, member);
    character.eidolons.forEach((eidolon, index) => {
      addFeatureSources(sources, relevantSourceIds, [eidolon], member, member.eidolon >= index + 1);
    });

    if (member.lightCone) {
      const cone = bundle.entities.equipment.find(({ kind, logicalId }) => (
        kind === "light-cone" && logicalId === member.lightCone?.logicalId
      ));
      if (cone) {
        relevantSourceIds.add(cone.revisionId);
        const legal = cone.pathRestriction === null || cone.pathRestriction === character.path;
        sources.set(cone.revisionId, {
          revision: cone, member, legal, reason: legal ? undefined : "illegal_equipment",
          scalingLevel: member.lightCone.superimposition,
        });
      }
    }

    for (const selectedSet of member.relicSets ?? []) {
      const set = bundle.entities.equipment.find(({ kind, logicalId }) => (
        kind === "relic-set" && logicalId === selectedSet.logicalId
      ));
      if (!set) continue;
      relevantSourceIds.add(set.revisionId);
      sources.set(set.revisionId, {
        revision: set, member, legal: true, scalingLevel: 1, setPieces: selectedSet.pieces,
      });
    }
  }

  return {
    build, scenario, bundle, sources, relevantSourceIds,
    memberIds: new Set(build.members.map(({ characterLogicalId }) => characterLogicalId)),
  };
}

export function buildEvidence(effect: Effect, context: EvaluationContext): EffectEvidence {
  const source = context.sources.get(effect.sourceRevisionId)?.revision;
  const provenance = source?.provenance.map((item) => ({ ...item })) ?? [];
  const provenanceIds = provenance.map((item) => (
    `${item.sourceName}:${item.sourceRevision}:${item.sourcePath}:${item.sourceChecksum}`
  ));
  return {
    id: `${context.bundle.release.id}:${effect.id}:${effect.sourceRevisionId}`,
    effectId: effect.id,
    sourceRevisionId: effect.sourceRevisionId,
    sourceLogicalId: source?.logicalId ?? effect.sourceRevisionId,
    sourceReviewStatus: source?.reviewStatus ?? effect.reviewStatus,
    releaseId: context.bundle.release.id,
    provenanceIds,
    provenance,
    originalText: effect.originalText,
  };
}
