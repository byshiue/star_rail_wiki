import type { Effect } from "../domain/effects";
import type { EvaluationContext, EvaluationReason, SourceSelection } from "./context";

export interface TargetResult { targets: string[]; reason?: EvaluationReason }

export function resolveTargets(
  effect: Effect, source: SourceSelection, context: EvaluationContext,
): TargetResult {
  const allies = [...context.memberIds].sort();
  const enemies = [...(context.scenario.enemies ?? ["enemy"])].sort();
  switch (effect.target.type) {
    case "self": return { targets: [source.memberId] };
    case "team": return { targets: allies };
    case "character-list": {
      const selected = new Set(effect.target.characterLogicalIds);
      return {
        targets: [...context.members.entries()]
          .filter(([, member]) => selected.has(member.characterLogicalId))
          .map(([memberId]) => memberId)
          .sort(),
      };
    }
    case "single-ally": {
      const evaluationId = `${source.sourceInstanceId}:${effect.id}`;
      const selected = context.scenario.targetAssignments?.[evaluationId] ?? context.scenario.targetAssignments?.[effect.id];
      if (!selected) return { targets: [], reason: "target_required" };
      return context.memberIds.has(selected)
        ? { targets: [selected] }
        : { targets: [], reason: "target_not_selected" };
    }
    case "single-enemy": {
      const evaluationId = `${source.sourceInstanceId}:${effect.id}`;
      const selected = context.scenario.targetAssignments?.[evaluationId] ?? context.scenario.targetAssignments?.[effect.id];
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
    const member = context.members.get(target);
    return member !== undefined && (
      member.consumableMetrics === undefined || member.consumableMetrics.includes(effect.metric)
    );
  });
}
