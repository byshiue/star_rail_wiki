import type { Effect, EffectMetric } from "../domain/effects";
import type { AggregationGroup, EvaluatedEffect, EvaluationWarning } from "./context";

const cappedMetrics: Partial<Record<EffectMetric, number>> = {
  critical_rate: 1,
  defense_reduction: 1,
  resistance_reduction: 1,
  action_advance: 1,
};

function reduceOperation(operation: Effect["operation"], values: number[]): number {
  if (operation === "multiplier") return values.reduce((total, value) => total * (1 + value), 1) - 1;
  if (operation === "override") return Math.max(...values);
  return values.reduce((total, value) => total + value, 0);
}

function valuesAfterStacking(entries: EvaluatedEffect[]): number[] {
  const byEffect = new Map<string, EvaluatedEffect[]>();
  for (const entry of entries) {
    const instances = byEffect.get(entry.effectId) ?? [];
    instances.push(entry);
    byEffect.set(entry.effectId, instances);
  }
  return [...byEffect.values()].flatMap((instances) => {
    const rule = instances[0]!.stacking;
    if (rule.type !== "additive") return [Math.max(...instances.map(({ value }) => value))];
    const stackValues = instances.flatMap((entry) => (
      Array.from({ length: entry.stacks }, () => entry.value / entry.stacks)
    )).sort((a, b) => b - a);
    return stackValues.slice(0, rule.maxStacks);
  });
}

function signature(targets: string[]): string {
  return [...targets].sort().join("|");
}

export function aggregateEffects(entries: EvaluatedEffect[]): {
  groups: AggregationGroup[];
  warnings: EvaluationWarning[];
} {
  const buckets = new Map<string, EvaluatedEffect[]>();
  for (const entry of entries) {
    const key = `${entry.metric}:${entry.operation}:${signature(entry.targets)}`;
    const group = buckets.get(key) ?? [];
    group.push(entry);
    buckets.set(key, group);
  }

  const warnings: EvaluationWarning[] = [];
  const groups = [...buckets.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([id, group]) => {
    const first = group[0]!;
    const values = valuesAfterStacking(group);
    let total = reduceOperation(first.operation, values);
    if (first.operation === "override" && new Set(values).size > 1) warnings.push({
      code: "conflicting_overrides", metric: first.metric,
      message: `Conflicting overrides for ${first.metric} on ${signature(first.targets)}; the highest is selected.`,
    });
    const cap = cappedMetrics[first.metric];
    if (cap !== undefined && total > cap) {
      warnings.push({ code: "metric_cap_exceeded", metric: first.metric, message: `${first.metric} exceeds its cap of ${cap}.` });
      total = cap;
    }
    return {
      id,
      metric: first.metric,
      operation: first.operation,
      targetSignature: signature(first.targets),
      targets: [...first.targets].sort(),
      total,
      effectIds: [...new Set(group.map(({ effectId }) => effectId))].sort(),
      evaluationIds: group.map(({ evaluationId }) => evaluationId).sort(),
    };
  });

  const metricOperations = new Map<string, Set<string>>();
  for (const group of groups) {
    const key = `${group.metric}:${group.operation}`;
    const signatures = metricOperations.get(key) ?? new Set<string>();
    signatures.add(group.targetSignature);
    metricOperations.set(key, signatures);
  }
  for (const [key, signatures] of metricOperations) {
    if (signatures.size <= 1) continue;
    const [metric] = key.split(":") as [EffectMetric];
    warnings.push({ code: "target_mismatch", metric, message: `${key} resolves to separate target groups.` });
  }
  return { groups, warnings };
}
