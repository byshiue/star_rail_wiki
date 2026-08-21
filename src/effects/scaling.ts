import type { Effect, ScalingValue, StackingRule } from "../domain/effects";
import type { EvaluationWarning } from "./context";

export interface ScalingResult {
  value: number;
  stacks: number;
  requestedStacks: number;
  warnings: EvaluationWarning[];
}

function normalizedLevel(level: number | undefined): number {
  return Number.isFinite(level) ? Math.max(1, Math.trunc(level ?? 1)) : 1;
}

export function resolveScalingValue(value: ScalingValue, level?: number): { value: number; exceeded: boolean } {
  const selectedLevel = normalizedLevel(level);
  if (selectedLevel === 1 || value.scaling.length === 0) return { value: value.base, exceeded: selectedLevel > 1 };
  const index = selectedLevel - 2;
  return {
    value: value.scaling[Math.min(index, value.scaling.length - 1)]!,
    exceeded: index >= value.scaling.length,
  };
}

export function resolveEffectValue(
  effect: Effect, level: number | undefined, requestedStacks: number | undefined,
): ScalingResult {
  const scaled = resolveScalingValue(effect.value, level);
  const warnings: EvaluationWarning[] = [];
  if (scaled.exceeded) warnings.push({
    code: "scaling_level_exceeded", effectId: effect.id,
    message: `Requested scaling level exceeds available values for ${effect.id}; using the highest value.`,
  });
  const stacks = resolveStacks(effect.stacking, requestedStacks);
  return {
    value: scaled.value * stacks.count,
    stacks: stacks.count,
    requestedStacks: stacks.requested,
    warnings,
  };
}

function resolveStacks(rule: StackingRule, requested: number | undefined) {
  if (rule.type !== "additive") return { count: 1, requested: 1 };
  const safeRequested = Number.isFinite(requested) ? Math.max(0, Math.trunc(requested ?? 1)) : 1;
  return { count: Math.min(safeRequested, rule.maxStacks), requested: safeRequested };
}
