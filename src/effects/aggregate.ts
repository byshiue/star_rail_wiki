import type { Effect, EffectMetric } from "../domain/effects";
import type { EvaluatedEffect, EvaluationWarning, MetricGroup } from "./context";

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

export function aggregateEffects(entries: EvaluatedEffect[]): {
  groups: Partial<Record<EffectMetric, MetricGroup>>;
  warnings: EvaluationWarning[];
} {
  const groups: Partial<Record<EffectMetric, MetricGroup>> = {};
  const warnings: EvaluationWarning[] = [];
  const metrics = [...new Set(entries.map(({ metric }) => metric))].sort();
  for (const metric of metrics) {
    const metricEntries = entries.filter((entry) => entry.metric === metric);
    const operations: MetricGroup["operations"] = {};
    const operationNames = [...new Set(metricEntries.map(({ operation }) => operation))].sort();
    for (const operation of operationNames) {
      const matching = metricEntries.filter((entry) => entry.operation === operation);
      let total = reduceOperation(operation, matching.map(({ value }) => value));
      if (operation === "override" && new Set(matching.map(({ value }) => value)).size > 1) {
        warnings.push({
          code: "conflicting_overrides", metric,
          message: `Conflicting overrides for ${metric}; the highest value is selected deterministically.`,
        });
      }
      const cap = cappedMetrics[metric];
      if (cap !== undefined && total > cap) {
        warnings.push({ code: "metric_cap_exceeded", metric, message: `${metric} exceeds its cap of ${cap}.` });
        total = cap;
      }
      operations[operation] = total;
    }
    const targetSignatures = new Set(metricEntries.map(({ targets }) => [...targets].sort().join("|")));
    if (targetSignatures.size > 1) {
      warnings.push({ code: "target_mismatch", metric, message: `${metric} effects resolve to incompatible targets.` });
    }
    groups[metric] = {
      metric,
      operations,
      total: operationNames.length === 1 && targetSignatures.size === 1
        ? operations[operationNames[0]!] ?? null : null,
      effectIds: metricEntries.map(({ effectId }) => effectId).sort(),
      targets: [...new Set(metricEntries.flatMap(({ targets }) => targets))].sort(),
    };
  }
  return { groups, warnings };
}
