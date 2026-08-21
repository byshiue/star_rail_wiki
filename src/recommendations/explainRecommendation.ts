import type { TeamEvaluation } from "../effects/evaluateTeam";
import type { ScoreComponents } from "./scoreTeam";

export interface RecommendationExplanation {
  summary: string;
  strengths: string[];
  weaknesses: string[];
  unmetConditions: Array<{ effectId: string; reason: string; evidenceId: string }>;
  evidenceIds: string[];
}

const componentLabels: Record<keyof ScoreComponents, string> = {
  roleCoverage: "职责覆盖", buffApplicability: "增益适用", mechanicSynergy: "机制协同",
  skillPointEconomy: "战技点经济", actionCompatibility: "行动兼容", weaknessCoverage: "弱点覆盖",
  survivability: "生存", activationCost: "启动成本", wastedEffects: "浪费效果", communityPrior: "社区先验",
};

export function explainRecommendation(
  team: readonly string[], components: ScoreComponents, evaluation: TeamEvaluation,
): RecommendationExplanation {
  const positive = (Object.entries(components) as Array<[keyof ScoreComponents, number]>)
    .filter(([key, value]) => value >= 0.5 && key !== "activationCost" && key !== "wastedEffects")
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([key, value]) => `${componentLabels[key]} ${Math.round(value * 100)}%`);
  const weaknesses = [
    ...(components.activationCost > 0 ? [`有 ${evaluation.inactive.length} 个条件尚未满足`] : []),
    ...(components.wastedEffects > 0 ? [`有 ${evaluation.wasted.length} 个效果没有有效受益者`] : []),
    ...(components.weaknessCoverage < 0.5 ? ["敌方弱点覆盖偏低"] : []),
  ];
  return {
    summary: `${team.join(" / ")}；按固定组件和 ${evaluation.evidence.length} 条模拟器证据评分。`,
    strengths: positive,
    weaknesses,
    unmetConditions: evaluation.inactive.map((effect) => ({
      effectId: effect.effectId, reason: effect.reason, evidenceId: effect.evidence.id,
    })),
    evidenceIds: evaluation.evidence.map(({ id }) => id),
  };
}
