import type { GameReleaseBundle } from "../domain/releases";
import type { AggregationGroup, EffectEvidence, TeamEvaluation } from "../effects/evaluateTeam";

type EvaluationEntry = TeamEvaluation["active"][number] | TeamEvaluation["inactive"][number];

const metricLabels: Record<string, string> = {
  attack: "攻击力", hp: "生命值", defense: "防御力", speed: "速度", critical_rate: "暴击率",
  critical_damage: "暴击伤害", break_effect: "击破特攻", effect_hit_rate: "效果命中",
  effect_resistance: "效果抵抗", energy: "能量", damage_bonus: "增伤", vulnerability: "易伤",
  defense_reduction: "减防", defense_ignore: "无视防御", resistance_reduction: "减抗",
  resistance_penetration: "抗性穿透", action_advance: "行动提前", action_delay: "行动延后",
  healing: "治疗", shielding: "护盾", skill_points: "战技点", mechanic_counter: "机制计数",
};

const percentMetrics = new Set([
  "attack", "hp", "defense", "critical_rate", "critical_damage", "break_effect",
  "effect_hit_rate", "effect_resistance", "damage_bonus", "vulnerability",
  "defense_reduction", "defense_ignore", "resistance_reduction", "resistance_penetration",
  "action_advance", "action_delay", "healing", "shielding",
]);

const categoryLabels = {
  active: "active · 生效",
  conditional: "conditional · 条件生效",
  inactive: "inactive · 未生效",
  unsupported: "unsupported · 不支持",
  wasted: "wasted · 无有效受益者",
} as const;

type EffectSummaryProps = {
  evaluation: TeamEvaluation | null;
  bundle: GameReleaseBundle;
  onEvidence: (evidence: EffectEvidence) => void;
};

function targetLabel(entry: EvaluationEntry, bundle: GameReleaseBundle): string {
  const target = bundle.entities.effects.find(({ id }) => id === entry.effectId)?.target.type;
  if (target === "team") return "全队";
  if (target === "self") return "自身";
  if (target === "single-ally") return "单体队友";
  if (target === "single-enemy") return "单个敌人";
  if (target === "all-enemies") return "全体敌人";
  return "目标";
}

function effectLabel(entry: EvaluationEntry, bundle: GameReleaseBundle): string {
  const target = targetLabel(entry, bundle);
  const metric = metricLabels[entry.metric] ?? entry.metric;
  if ("value" in entry && typeof entry.value === "number") {
    const effect = bundle.entities.effects.find(({ id }) => id === entry.effectId);
    const value = effect?.operation === "percent" || effect?.operation === "multiplier"
      ? `${Math.round(entry.value * 10000) / 100}%`
      : String(Math.round(entry.value * 100) / 100);
    return `${target}${metric} +${value}`;
  }
  return `${target}${metric}`;
}

function groupTargetLabel(group: AggregationGroup, bundle: GameReleaseBundle): string {
  const target = bundle.entities.effects.find(({ id }) => group.effectIds.includes(id))?.target.type;
  const concrete = group.targets.length ? group.targets.join("、") : "无具体目标";
  if (target === "team") return `全队（${concrete}）`;
  if (target === "self") return `自身（${concrete}）`;
  if (target === "single-ally") return `单体队友（${concrete}）`;
  if (target === "single-enemy") return `单个敌人（${concrete}）`;
  if (target === "all-enemies") return `全体敌人（${concrete}）`;
  return concrete;
}

function groupValue(group: AggregationGroup, value: number): string {
  const rendered = percentMetrics.has(group.metric)
    ? `${Math.round(value * 10000) / 100}%`
    : String(Math.round(value * 100) / 100);
  return value >= 0 ? `+${rendered}` : rendered;
}

export function EffectSummary({ evaluation, bundle, onEvidence }: EffectSummaryProps) {
  const categories = (Object.keys(categoryLabels) as Array<keyof typeof categoryLabels>);
  return (
    <section className="results-panel" aria-labelledby="evaluation-title">
      <p className="eyebrow">评估结果</p>
      <h2 id="evaluation-title">按目标与指标分类</h2>
      {!evaluation ? <p className="empty-result">选择角色后显示效果；这里不计算伤害，只解释结构化增益与减益。</p> : null}
      {evaluation?.groups.length ? (
        <section className="aggregation-groups" aria-labelledby="groups-title">
          <h3 id="groups-title">applied groups · 已应用汇总</h3>
          <ul>
            {evaluation.groups.map((group) => {
              const stackWarnings = evaluation.warnings.filter((warning) => (
                warning.code === "stack_cap_exceeded"
                && warning.evaluationIds?.some((id) => group.evaluationIds.includes(id))
              ));
              return (
                <li key={group.id}>
                  <strong>{groupTargetLabel(group, bundle)} · {metricLabels[group.metric] ?? group.metric} · {group.operation}</strong>
                  <span>应用值：{group.appliedValues.map((value) => groupValue(group, value)).join("、")} · 合计：{groupValue(group, group.total)}</span>
                  {group.cap !== null ? <span>上限：{groupValue(group, group.cap).replace(/^\+/, "")}</span> : null}
                  {stackWarnings.map((warning) => (
                    <span key={warning.effectId}>叠层上限：{warning.stackCap}（请求 {warning.requestedStacks}，舍弃 {warning.discardedStacks}）</span>
                  ))}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      {categories.map((category) => {
        const entries = evaluation?.[category] ?? [];
        return (
          <section className="effect-category" key={category} aria-labelledby={`category-${category}`}>
            <h3 id={`category-${category}`}>{categoryLabels[category]} <span>{entries.length}</span></h3>
            {entries.length ? (
              <ul>
                {entries.map((entry) => {
                  const label = effectLabel(entry, bundle);
                  return (
                    <li key={entry.evaluationId}>
                      <div><strong>{label}</strong>{"reason" in entry ? <small>原因：{entry.reason}</small> : null}</div>
                      <button type="button" aria-label={`查看${label.replace(/ \+.*$/, "")}来源`} onClick={() => onEvidence(entry.evidence)}>查看来源</button>
                    </li>
                  );
                })}
              </ul>
            ) : <p>无</p>}
          </section>
        );
      })}
      {evaluation?.warnings.length ? (
        <section className="evaluation-warnings" aria-labelledby="warnings-title">
          <h3 id="warnings-title">warnings · 评估警告</h3>
          <ul aria-label="评估警告">{evaluation.warnings.map((warning, index) => <li key={`${warning.code}:${index}`}>{warning.message}</li>)}</ul>
        </section>
      ) : null}
    </section>
  );
}
