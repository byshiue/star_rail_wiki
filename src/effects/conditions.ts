import type { ConditionExpression, Effect } from "../domain/effects";
import type { EvaluationContext, EvaluationReason, SourceSelection } from "./context";

export interface ConditionResult { active: boolean; reason?: EvaluationReason | string }

function conditionKey(type: string): string {
  return type.trim().toLowerCase().replaceAll("_", "-");
}

function actualValue(condition: ConditionExpression, source: SourceSelection, context: EvaluationContext) {
  const key = conditionKey(condition.type);
  if (key === "enemy-broken") return context.scenario.enemyBroken;
  if (key === "enemy-weakness") return context.scenario.enemyWeaknesses;
  if (key === "set-pieces") return source.setPieces;
  return context.scenario.conditions?.[condition.type]
    ?? context.scenario.conditions?.[key]
    ?? context.scenario.conditions?.[key.replaceAll("-", "_")];
}

function compare(actual: unknown, condition: ConditionExpression): boolean {
  const expected = condition.value ?? true;
  if (Array.isArray(actual)) {
    if (condition.operator === "not-equals") return !actual.includes(expected);
    return actual.includes(expected);
  }
  switch (condition.operator ?? "equals") {
    case "equals": return actual === expected;
    case "not-equals": return actual !== expected;
    case "at-least": return typeof actual === "number" && typeof expected === "number" && actual >= expected;
    case "at-most": return typeof actual === "number" && typeof expected === "number" && actual <= expected;
  }
}

export function evaluateConditions(
  conditions: ConditionExpression[], source: SourceSelection, context: EvaluationContext,
): ConditionResult {
  const ordered = [...conditions].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  for (const condition of ordered) {
    const actual = actualValue(condition, source, context);
    if (actual === undefined) return { active: false, reason: "condition_unknown" };
    if (!compare(actual, condition)) return {
      active: false,
      reason: conditionKey(condition.type) === "enemy-broken" ? "enemy_not_broken" : "condition_not_met",
    };
  }
  return { active: true };
}

export function evaluateTriggerAndDuration(
  effect: Effect, source: SourceSelection, context: EvaluationContext,
): ConditionResult {
  const scenario = context.scenario;
  const evaluationId = `${source.sourceInstanceId}:${effect.id}`;
  const remaining = effect.duration.type === "turns"
    ? scenario.remainingTurns?.[evaluationId] ?? scenario.remainingTurns?.[effect.id]
    : effect.duration.type === "actions"
      ? scenario.remainingActions?.[evaluationId] ?? scenario.remainingActions?.[effect.id] : undefined;
  const fired = (() => {
    switch (effect.trigger.type) {
      case "always": return false;
      case "battle-start": return scenario.firedThisEvaluation?.battleStart === true;
      case "action": return scenario.firedThisEvaluation?.action === true;
      case "event": return scenario.firedThisEvaluation?.events?.includes(effect.trigger.event) === true;
    }
  })();
  if (fired) return { active: true };
  const notFired = (): ConditionResult => {
    switch (effect.trigger.type) {
      case "always": return { active: true };
      case "battle-start": return { active: false, reason: "battle_not_started" };
      case "action": return { active: false, reason: "action_not_active" };
      case "event": return { active: false, reason: "event_not_triggered" };
    }
  };
  if (effect.duration.type === "turns" || effect.duration.type === "actions") {
    if (remaining !== undefined && remaining <= 0) return { active: false, reason: "duration_expired" };
    if (remaining !== undefined && remaining > 0) return { active: true };
    if (effect.trigger.type !== "always") return notFired();
  }
  if (effect.duration.type === "instant" && effect.trigger.type !== "always") return notFired();
  switch (effect.trigger.type) {
    case "always": return { active: true };
    case "battle-start": return scenario.battleStarted
      ? { active: true } : { active: false, reason: "battle_not_started" };
    case "action": return scenario.actionActive
      ? { active: true } : { active: false, reason: "action_not_active" };
    case "event": return scenario.activeEvents?.includes(effect.trigger.event)
      ? { active: true } : { active: false, reason: "event_not_triggered" };
  }
}
