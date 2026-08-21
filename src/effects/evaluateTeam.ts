import type { Effect } from "../domain/effects";
import type { GameReleaseBundle } from "../domain/releases";
import { aggregateEffects } from "./aggregate";
import {
  buildEvidence, createEvaluationContext,
  type BattleScenario, type EvaluatedEffect, type EvaluationContext, type ExcludedEffect,
  type SourceSelection, type TeamBuild, type TeamEvaluation,
} from "./context";
import { evaluateConditions, evaluateTriggerAndDuration } from "./conditions";
import { resolveEffectValue } from "./scaling";
import { hasCompatibleConsumer, resolveTargets } from "./targets";

export type {
  AggregationGroup, BattleScenario, EffectEvidence, EvaluatedEffect, EvaluationWarning,
  FiredThisEvaluation, TeamBuild, TeamBuildIssue, TeamEvaluation, TeamMemberBuild,
} from "./context";
export { TeamBuildValidationError } from "./context";

function baseEntry(effect: Effect, source: SourceSelection, context: EvaluationContext) {
  return {
    evaluationId: `${source.sourceInstanceId}:${effect.id}`,
    effectId: effect.id,
    sourceInstanceId: source.sourceInstanceId,
    sourceRevisionId: effect.sourceRevisionId,
    metric: effect.metric,
    operation: effect.operation,
    stacking: effect.stacking,
    evidence: buildEvidence(effect, source, context),
  };
}

function excluded(
  effect: Effect, source: SourceSelection, context: EvaluationContext, reason: ExcludedEffect["reason"],
): ExcludedEffect {
  return { ...baseEntry(effect, source, context), reason };
}

function reviewReason(effect: Effect, source: SourceSelection): ExcludedEffect["reason"] | undefined {
  if (effect.reviewStatus === "unsupported") return "unsupported_effect";
  if (effect.reviewStatus === "generated") return "effect_not_reviewed";
  if (source.revision.reviewStatus === "unsupported") return "unsupported_source";
  if (source.revision.reviewStatus === "generated") return "source_not_reviewed";
  return undefined;
}

function sortByEvaluationId<T extends { evaluationId: string }>(items: T[]): T[] {
  return items.sort((a, b) => a.evaluationId.localeCompare(b.evaluationId));
}

export function evaluateTeam(
  build: TeamBuild, scenario: BattleScenario, bundle: GameReleaseBundle,
): TeamEvaluation {
  const context = createEvaluationContext(build, scenario, bundle);
  const active: EvaluatedEffect[] = [];
  const conditional: EvaluatedEffect[] = [];
  const inactive: ExcludedEffect[] = [];
  const unsupported: ExcludedEffect[] = [];
  const wasted: ExcludedEffect[] = [];
  const warnings: TeamEvaluation["warnings"] = [];
  const effectsBySource = new Map<string, Effect[]>();
  for (const effect of bundle.entities.effects) {
    const effects = effectsBySource.get(effect.sourceRevisionId) ?? [];
    effects.push(effect);
    effectsBySource.set(effect.sourceRevisionId, effects);
  }
  for (const effects of effectsBySource.values()) effects.sort((a, b) => a.id.localeCompare(b.id));

  for (const source of context.sources) {
    for (const effect of effectsBySource.get(source.revision.revisionId) ?? []) {
      if (!source.legal) {
        inactive.push(excluded(effect, source, context, source.reason ?? "source_not_selected"));
        continue;
      }
      const excludedByReview = reviewReason(effect, source);
      if (excludedByReview) {
        unsupported.push(excluded(effect, source, context, excludedByReview));
        continue;
      }
      const condition = evaluateConditions(effect.conditions, source, context);
      if (!condition.active) {
        inactive.push(excluded(effect, source, context, condition.reason ?? "condition_not_met"));
        continue;
      }
      const trigger = evaluateTriggerAndDuration(effect, source, context);
      if (!trigger.active) {
        inactive.push(excluded(effect, source, context, trigger.reason ?? "condition_not_met"));
        continue;
      }
      const target = resolveTargets(effect, source, context);
      if (target.reason) {
        inactive.push(excluded(effect, source, context, target.reason));
        warnings.push({
          code: "target_mismatch", effectId: effect.id, metric: effect.metric,
          message: `${effect.id} from ${source.sourceInstanceId} has no legal selected target.`,
        });
        continue;
      }
      const explicitLevel = build.effectLevels?.[effect.id];
      const evaluationId = `${source.sourceInstanceId}:${effect.id}`;
      const requestedStacks = scenario.stacks?.[evaluationId] ?? scenario.stacks?.[effect.id];
      const scaling = resolveEffectValue(effect, explicitLevel ?? source.scalingLevel, requestedStacks);
      warnings.push(...scaling.warnings);
      if (scaling.stacks === 0) {
        inactive.push({
          ...excluded(effect, source, context, "no_active_stacks"),
          value: 0, stacks: 0, requestedStacks: scaling.requestedStacks,
          targets: target.targets,
        });
        continue;
      }
      const entry: EvaluatedEffect = {
        ...baseEntry(effect, source, context),
        value: scaling.value, stacks: scaling.stacks,
        requestedStacks: scaling.requestedStacks, targets: target.targets,
      };
      if (!hasCompatibleConsumer(effect, target.targets, context)) {
        wasted.push({ ...entry, reason: "no_compatible_consumer" });
        warnings.push({
          code: "no_compatible_consumer", effectId: effect.id, metric: effect.metric,
          message: `${effect.id} from ${source.sourceInstanceId} has no compatible selected consumer.`,
        });
        continue;
      }
      const isConditional = effect.conditions.length > 0
        || effect.trigger.type !== "always" || effect.duration.type !== "permanent";
      (isConditional ? conditional : active).push(entry);
    }
  }

  const aggregate = aggregateEffects([...active, ...conditional]);
  warnings.push(...aggregate.warnings);
  const evidence = [...active, ...conditional, ...inactive, ...unsupported, ...wasted]
    .map(({ evidence: item }) => item)
    .sort((a, b) => a.id.localeCompare(b.id));
  return {
    active: sortByEvaluationId(active), conditional: sortByEvaluationId(conditional),
    inactive: sortByEvaluationId(inactive), unsupported: sortByEvaluationId(unsupported),
    wasted: sortByEvaluationId(wasted), evidence, groups: aggregate.groups,
    warnings: warnings.sort((a, b) => `${a.code}:${a.effectId ?? ""}:${a.metric ?? ""}:${a.message}`
      .localeCompare(`${b.code}:${b.effectId ?? ""}:${b.metric ?? ""}:${b.message}`)),
  };
}
