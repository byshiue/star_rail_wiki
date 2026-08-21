import type { ConditionExpression, Effect } from "../domain/effects";
import type { EvaluationContext, EvaluationReason } from "./context";

export interface ConditionResult { active: boolean; reason?: EvaluationReason | string }

function conditionKey(type: string): string {
  return type.trim().toLowerCase().replaceAll("_", "-");
}

function actualValue(condition: ConditionExpression, effect: Effect, context: EvaluationContext) {
  const key = conditionKey(condition.type);
  if (key === "enemy-broken") return context.scenario.enemyBroken;
  if (key === "enemy-weakness") return context.scenario.enemyWeaknesses;
  if (key === "set-pieces") return context.sources.get(effect.sourceRevisionId)?.setPieces;
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
  conditions: ConditionExpression[], effect: Effect, context: EvaluationContext,
): ConditionResult {
  const ordered = [...conditions].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  for (const condition of ordered) {
    const actual = actualValue(condition, effect, context);
    if (actual === undefined) return { active: false, reason: "condition_unknown" };
    if (!compare(actual, condition)) {
      return {
        active: false,
        reason: conditionKey(condition.type) === "enemy-broken" ? "enemy_not_broken" : "condition_not_met",
      };
    }
  }
  return { active: true };
}

export function evaluateTriggerAndDuration(effect: Effect, context: EvaluationContext): ConditionResult {
  const scenario = context.scenario;
  const remaining = effect.duration.type === "turns"
    ? scenario.remainingTurns?.[effect.id]
    : effect.duration.type === "actions" ? scenario.remainingActions?.[effect.id] : undefined;
  const trigger = (() : ConditionResult => {
    switch (effect.trigger.type) {
      case "always": return { active: true };
      case "battle-start": return scenario.battleStarted
        ? { active: true } : { active: false, reason: "battle_not_started" };
      case "action": return scenario.actionActive
        ? { active: true } : { active: false, reason: "action_not_active" };
      case "event": return scenario.triggeredEvents?.includes(effect.trigger.event)
        ? { active: true } : { active: false, reason: "event_not_triggered" };
    }
  })();
  if (trigger.active && effect.trigger.type !== "always") return trigger;
  if (remaining !== undefined && remaining <= 0) return { active: false, reason: "duration_expired" };
  if (remaining !== undefined && remaining > 0) return { active: true };
  return trigger;
}
