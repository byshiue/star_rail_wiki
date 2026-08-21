import type { Effect } from "../domain/effects";
import type { EvaluationContext, EvaluationReason } from "./context";

export interface TargetResult { targets: string[]; reason?: EvaluationReason }

export function resolveTargets(effect: Effect, context: EvaluationContext): TargetResult {
  const owner = context.sources.get(effect.sourceRevisionId)?.member.characterLogicalId;
  const allies = [...context.memberIds].sort();
  const enemies = [...(context.scenario.enemies ?? ["enemy"])].sort();
  switch (effect.target.type) {
    case "self": return owner ? { targets: [owner] } : { targets: [], reason: "target_not_selected" };
    case "team": return { targets: allies };
    case "single-ally": {
      const selected = context.scenario.targetAssignments?.[effect.id];
      if (!selected) return { targets: [], reason: "target_required" };
      return context.memberIds.has(selected)
        ? { targets: [selected] }
        : { targets: [], reason: "target_not_selected" };
    }
    case "single-enemy": {
      const selected = context.scenario.targetAssignments?.[effect.id];
      if (!selected) return { targets: [], reason: "target_required" };
      return enemies.includes(selected)
        ? { targets: [selected] }
        : { targets: [], reason: "target_not_selected" };
    }
    case "all-enemies": return { targets: enemies };
  }
}

export function hasCompatibleConsumer(effect: Effect, targets: string[], context: EvaluationContext): boolean {
  if (effect.target.type === "single-enemy" || effect.target.type === "all-enemies") return targets.length > 0;
  return targets.some((target) => {
    const member = context.build.members.find(({ characterLogicalId }) => characterLogicalId === target);
    return member !== undefined && (
      member.consumableMetrics === undefined || member.consumableMetrics.includes(effect.metric)
    );
  });
}
