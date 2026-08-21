import type { Effect } from "../domain/effects";
import type { RevisionIdentity } from "../domain/entities";
import type { DataRelease } from "../domain/releases";
import { VersionBadge } from "./VersionBadge";

const metricLabels: Record<Effect["metric"], string> = {
  attack: "攻击力", hp: "生命值", defense: "防御力", speed: "速度", critical_rate: "暴击率",
  critical_damage: "暴击伤害", break_effect: "击破特攻", effect_hit_rate: "效果命中",
  effect_resistance: "效果抵抗", energy: "能量", damage_bonus: "伤害加成", vulnerability: "易伤",
  defense_reduction: "防御降低", defense_ignore: "无视防御", resistance_reduction: "抗性降低",
  resistance_penetration: "抗性穿透", action_advance: "行动提前", action_delay: "行动延后",
  healing: "治疗", shielding: "护盾", skill_points: "战技点", mechanic_counter: "机制计数",
};
const targetLabels: Record<Effect["target"]["type"], string> = {
  self: "自身", "single-ally": "单体队友", team: "全队", "single-enemy": "单体敌人", "all-enemies": "敌方全体",
};
function formatValue(effect: Effect): string {
  return effect.operation === "percent" || effect.operation === "multiplier" ? `${effect.value.base * 100}%` : String(effect.value.base);
}

export function EffectSourceList({ revision, effects, release }: { revision: RevisionIdentity; effects: Effect[]; release: DataRelease }) {
  return <div className="evidence-block">
    <div className="revision-line">
      <VersionBadge release={release} />
      <span>审阅状态：{("reviewStatus" in revision) ? String(revision.reviewStatus) : "unknown"}</span>
      <span>有效期：{revision.validFromReleaseId} → {revision.validToReleaseId ?? "当前修订"}</span>
    </div>
    {effects.length > 0 && <ul className="effect-list" aria-label="可用效果">{effects.map((effect) => <li key={effect.id}>
      <strong>{targetLabels[effect.target.type]} · {metricLabels[effect.metric]} · {formatValue(effect)}</strong>
      <span>（{effect.reviewStatus}）</span><p>{effect.originalText}</p>
    </li>)}</ul>}
    <ul className="provenance-list">{revision.provenance.map((source) => <li key={`${source.sourceUrl}:${source.sourcePath}`}>
      <a href={source.sourceUrl} target="_blank" rel="noreferrer">资料来源：{source.sourceName}</a>
      <span>{source.sourcePath} · revision {source.sourceRevision}</span>
    </li>)}</ul>
  </div>;
}
