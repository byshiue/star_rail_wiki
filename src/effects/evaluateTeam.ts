import type { Effect } from "../domain/effects";
import type { GameReleaseBundle } from "../domain/releases";
import { aggregateEffects } from "./aggregate";
import {
  buildEvidence, createEvaluationContext,
  type BattleScenario, type EvaluatedEffect, type ExcludedEffect,
  type TeamBuild, type TeamEvaluation,
} from "./context";
import { evaluateConditions, evaluateTriggerAndDuration } from "./conditions";
import { resolveEffectValue } from "./scaling";
import { hasCompatibleConsumer, resolveTargets } from "./targets";

export type {
  BattleScenario, EffectEvidence, EvaluatedEffect, EvaluationWarning, MetricGroup,
  TeamBuild, TeamEvaluation, TeamMemberBuild,
} from "./context";

function baseEntry(effect: Effect, context: ReturnType<typeof createEvaluationContext>) {
  return {
    effectId: effect.id,
    sourceRevisionId: effect.sourceRevisionId,
    metric: effect.metric,
    operation: effect.operation,
    evidence: buildEvidence(effect, context),
  };
}

function excluded(
  effect: Effect, context: ReturnType<typeof createEvaluationContext>, reason: ExcludedEffect["reason"],
): ExcludedEffect {
  return { ...baseEntry(effect, context), reason };
}

function sortByEffectId<T extends { effectId: string }>(items: T[]): T[] {
  return items.sort((a, b) => a.effectId.localeCompare(b.effectId));
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

  const effects = bundle.entities.effects
    .filter(({ sourceRevisionId }) => context.relevantSourceIds.has(sourceRevisionId))
    .sort((a, b) => a.id.localeCompare(b.id));

  for (const effect of effects) {
    const source = context.sources.get(effect.sourceRevisionId);
    if (!source?.legal) {
      inactive.push(excluded(effect, context, source?.reason ?? "source_not_selected"));
      continue;
    }
    if (effect.reviewStatus !== "reviewed" || source.revision.reviewStatus !== "reviewed") {
      unsupported.push(excluded(
        effect, context, effect.reviewStatus === "unsupported" ? "unsupported_effect" : "review_not_approved",
      ));
      continue;
    }
    const condition = evaluateConditions(effect.conditions, effect, context);
    if (!condition.active) {
      inactive.push(excluded(effect, context, condition.reason ?? "condition_not_met"));
      continue;
    }
    const trigger = evaluateTriggerAndDuration(effect, context);
    if (!trigger.active) {
      inactive.push(excluded(effect, context, trigger.reason ?? "condition_not_met"));
      continue;
    }
    const target = resolveTargets(effect, context);
    if (target.reason) {
      inactive.push(excluded(effect, context, target.reason));
      warnings.push({ code: "target_mismatch", effectId: effect.id, metric: effect.metric, message: `${effect.id} has no legal selected target.` });
      continue;
    }
    const explicitLevel = build.effectLevels?.[effect.id];
    const scaling = resolveEffectValue(effect, explicitLevel ?? source.scalingLevel, scenario.stacks?.[effect.id]);
    warnings.push(...scaling.warnings);
    if (scaling.stacks === 0) {
      inactive.push({ ...excluded(effect, context, "no_active_stacks"), value: 0, stacks: 0, targets: target.targets });
      continue;
    }
    const entry: EvaluatedEffect = {
      ...baseEntry(effect, context), value: scaling.value, stacks: scaling.stacks, targets: target.targets,
    };
    if (!hasCompatibleConsumer(effect, target.targets, context)) {
      wasted.push({ ...entry, reason: "no_compatible_consumer" });
      warnings.push({ code: "no_compatible_consumer", effectId: effect.id, metric: effect.metric, message: `${effect.id} has no compatible selected consumer.` });
      continue;
    }
    const isConditional = effect.conditions.length > 0
      || effect.trigger.type !== "always" || effect.duration.type !== "permanent";
    (isConditional ? conditional : active).push(entry);
  }

  const aggregate = aggregateEffects([...active, ...conditional]);
  warnings.push(...aggregate.warnings);
  const evidence = [...active, ...conditional, ...inactive, ...unsupported, ...wasted]
    .map(({ evidence: item }) => item)
    .sort((a, b) => a.id.localeCompare(b.id));
  return {
    active: sortByEffectId(active), conditional: sortByEffectId(conditional),
    inactive: sortByEffectId(inactive), unsupported: sortByEffectId(unsupported),
    wasted: sortByEffectId(wasted), evidence,
    groups: aggregate.groups,
    warnings: warnings.sort((a, b) => `${a.code}:${a.effectId ?? ""}:${a.metric ?? ""}`
      .localeCompare(`${b.code}:${b.effectId ?? ""}:${b.metric ?? ""}`)),
  };
}
