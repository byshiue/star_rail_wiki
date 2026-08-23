import type { GameReleaseBundle } from "../domain/releases";
import type { EvaluationReason } from "../effects/context";
import type { AggregationGroup, EffectEvidence, TeamEvaluation } from "../effects/evaluateTeam";

type EvaluationEntry = TeamEvaluation["active"][number] | TeamEvaluation["inactive"][number];

const metricLabels: Record<string, string> = {
  attack: "攻击力", hp: "生命值", defense: "防御力", speed: "速度", critical_rate: "暴击率",
  critical_damage: "暴击伤害", break_effect: "击破特攻", effect_hit_rate: "效果命中",
  effect_resistance: "效果抵抗", energy: "能量", damage_bonus: "增伤", vulnerability: "易伤",
  defense_reduction: "减防", defense_ignore: "无视防御", resistance_reduction: "减抗",
  resistance_penetration: "抗性穿透", action_advance: "行动提前", action_delay: "行动延后",
  healing: "治疗", shielding: "护盾", skill_points: "战技点", mechanic_counter: "机制计数",
  unclassified_numeric: "未分类数值机制",
};

const categoryLabels = {
  active: "active · 生效",
  conditional: "conditional · 条件生效",
  available: "available · 可触发",
  inactive: "inactive · 未生效",
  unsupported: "unsupported · 不支持",
  wasted: "wasted · 无有效受益者",
} as const;
type DisplayCategory = keyof typeof categoryLabels;

const auditCategories = new Set<DisplayCategory>(["inactive", "unsupported", "wasted"]);
const availableReasons = new Set<EvaluationReason>([
  "battle_not_started", "action_not_active", "event_not_triggered", "duration_expired",
  "target_required", "target_not_selected", "enemy_not_broken", "condition_unknown", "condition_not_met",
]);

const knownReasonLabels = {
  source_not_selected: "来源未选择",
  eidolon_locked: "需要更高星魂",
  illegal_equipment: "装备与角色命途不匹配",
  effect_not_reviewed: "效果尚未审核",
  source_not_reviewed: "来源尚未审核",
  unsupported_effect: "该效果尚不支持模拟",
  unsupported_source: "该来源尚不支持模拟",
  battle_not_started: "战斗尚未开始",
  action_not_active: "指定行动尚未触发",
  event_not_triggered: "指定事件尚未触发",
  duration_expired: "效果持续时间已结束",
  target_required: "需要指定目标",
  target_not_selected: "指定目标未入队",
  no_active_stacks: "当前没有有效层数",
  no_compatible_consumer: "队伍中没有有效受益者",
  enemy_not_broken: "敌人尚未处于弱点击破状态",
  condition_unknown: "缺少条件资料",
  condition_not_met: "触发条件未满足",
} satisfies Record<EvaluationReason, string>;
const reasonLabels: Record<string, string> = knownReasonLabels;

type EffectSummaryProps = {
  evaluation: TeamEvaluation | null;
  bundle: GameReleaseBundle;
  onEvidence: (evidence: EffectEvidence) => void;
};

function targetLabel(entry: EvaluationEntry, bundle: GameReleaseBundle): string {
  const target = bundle.entities.effects.find(({ id }) => id === entry.effectId)?.target.type;
  if (target === "team") return "全队";
  if (target === "team-except-self") return "除自身外全队";
  if (target === "character-list") return "指定角色";
  if (target === "self") return "自身";
  if (target === "single-ally") return "单体队友";
  if (target === "single-other-ally") return "单体其他队友";
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
  if (target === "team-except-self") return `除自身外全队（${concrete}）`;
  if (target === "character-list") return `指定角色（${concrete}）`;
  if (target === "self") return `自身（${concrete}）`;
  if (target === "single-ally") return `单体队友（${concrete}）`;
  if (target === "single-other-ally") return `单体其他队友（${concrete}）`;
  if (target === "single-enemy") return `单个敌人（${concrete}）`;
  if (target === "all-enemies") return `全体敌人（${concrete}）`;
  return concrete;
}

function rounded(value: number): string {
  return String(Math.round(value * 100) / 100);
}

function groupValue(group: AggregationGroup, value: number): string {
  if (group.operation === "percent") return `${value >= 0 ? "+" : ""}${rounded(value * 100)}%`;
  if (group.operation === "multiplier") return `×${rounded(1 + value)}`;
  if (group.operation === "override") return `设为 ${rounded(value)}`;
  return `${value >= 0 ? "+" : ""}${rounded(value)}`;
}

function capValue(group: AggregationGroup, value: number): string {
  if (group.operation === "percent") return `${rounded(value * 100)}%`;
  if (group.operation === "multiplier") return `×${rounded(1 + value)}`;
  return rounded(value);
}

function categoryEntries(
  evaluation: TeamEvaluation | null, category: DisplayCategory,
): EvaluationEntry[] {
  if (!evaluation) return [];
  const available = evaluation.inactive.filter(({ reason }) => (
    availableReasons.has(reason as EvaluationReason)
  ));
  if (category === "available") return available;
  if (category === "inactive") {
    const availableIds = new Set(available.map(({ evaluationId }) => evaluationId));
    return evaluation.inactive.filter(({ evaluationId }) => !availableIds.has(evaluationId));
  }
  return evaluation[category];
}

export function EffectSummary({ evaluation, bundle, onEvidence }: EffectSummaryProps) {
  const categories = (Object.keys(categoryLabels) as DisplayCategory[]);
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
                  {group.cap !== null ? <span>上限：{capValue(group, group.cap)}</span> : null}
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
        const entries = categoryEntries(evaluation, category);
        const categoryId = `category-${category}`;
        const content = entries.length ? (
          <ul>
            {entries.map((entry) => {
              const label = effectLabel(entry, bundle);
              const reason = "reason" in entry ? reasonLabels[entry.reason] ?? entry.reason : null;
              return (
                <li key={entry.evaluationId}>
                  <div><strong>{label}</strong>{reason ? <small>原因：{reason}</small> : null}</div>
                  <button type="button" aria-label={`查看${label.replace(/ \+.*$/, "")}来源`} onClick={() => onEvidence(entry.evidence)}>查看来源</button>
                </li>
              );
            })}
          </ul>
        ) : <p>无</p>;
        if (auditCategories.has(category)) {
          return (
            <details className="effect-category audit-category" key={category} aria-labelledby={categoryId}>
              <summary><strong id={categoryId}>{categoryLabels[category]}</strong><span>{entries.length}</span></summary>
              {content}
            </details>
          );
        }
        return (
          <section className="effect-category" key={category} aria-labelledby={categoryId}>
            <h3 id={categoryId}>{categoryLabels[category]} <span>{entries.length}</span></h3>
            {content}
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
