import type { Effect } from "../domain/effects";
import type { GameReleaseBundle } from "../domain/releases";
import { aggregateEffects } from "../effects/aggregate";
import type { EvaluatedEffect, TeamBuild, TeamEvaluation } from "../effects/evaluateTeam";

export const buffMetricLabels: Record<string, string> = {
  attack: "攻击力", hp: "生命值", defense: "防御力", speed: "速度", critical_rate: "暴击率",
  critical_damage: "暴击伤害", break_effect: "击破特攻", effect_hit_rate: "效果命中",
  effect_resistance: "效果抵抗", energy: "能量", damage_bonus: "增伤", vulnerability: "易伤",
  defense_reduction: "减防", defense_ignore: "无视防御", resistance_reduction: "减抗",
  resistance_penetration: "抗性穿透", action_advance: "行动提前", action_delay: "行动延后",
  healing: "治疗", shielding: "护盾", skill_points: "战技点", mechanic_counter: "机制计数",
};

export type BuffContribution = {
  memberId: string;
  characterName: string;
  eidolon: number;
  value: number;
};

export type BuffBreakdownRow = {
  id: string;
  metricLabel: string;
  scopeLabel: string;
  operation: Effect["operation"];
  total: number;
  cap: number | null;
  conditional: boolean;
  adjustmentLabel: "取最高" | "已达到上限" | "叠加规则调整" | null;
  contributions: BuffContribution[];
};

export type UnsupportedCharacterBuffs = {
  memberId: string;
  characterName: string;
  eidolon: number;
  labels: string[];
};

function memberIdOf(sourceInstanceId: string, build: TeamBuild): string | undefined {
  return build.members
    .map((member, index) => member.slotId ?? `slot-${index + 1}`)
    .find((memberId) => sourceInstanceId.startsWith(`${memberId}:`));
}

function characterName(logicalId: string, bundle: GameReleaseBundle): string {
  return bundle.entities.characters.find((character) => (
    character.logicalId === logicalId && character.validToReleaseId === null
  ))?.name ?? logicalId;
}


function scopeLabel(type: Effect["target"]["type"] | undefined): string {
  if (type === "team") return "全队";
  if (type === "team-except-self") return "除自身外全队";
  if (type === "character-list") return "指定角色";
  if (type === "self") return "自身";
  if (type === "single-ally") return "单体队友";
  if (type === "single-other-ally") return "单体其他队友";
  if (type === "single-enemy") return "单个敌人";
  if (type === "all-enemies") return "全体敌人";
  return "指定目标";
}

function combine(operation: Effect["operation"], values: number[]): number {
  if (!values.length) return 0;
  if (operation === "multiplier") return values.reduce((total, value) => total * (1 + value), 1) - 1;
  if (operation === "override") return Math.max(...values);
  return values.reduce((total, value) => total + value, 0);
}

function semanticEntryGroups(evaluation: TeamEvaluation, bundle: GameReleaseBundle) {
  const effects = new Map(bundle.entities.effects.map((effect) => [effect.id, effect]));
  const buckets = new Map<string, { targetType: Effect["target"]["type"] | undefined; entries: EvaluatedEffect[] }>();
  for (const entry of [...evaluation.active, ...evaluation.conditional]) {
    const targetType = effects.get(entry.effectId)?.target.type;
    const key = [
      targetType ?? "unknown", entry.metric, entry.operation, [...entry.targets].sort().join("|"),
    ].join(":");
    const bucket = buckets.get(key) ?? { targetType, entries: [] };
    bucket.entries.push(entry);
    buckets.set(key, bucket);
  }
  return [...buckets.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, bucket]) => bucket);
}

export function buildBuffBreakdown(
  build: TeamBuild, evaluation: TeamEvaluation | null, bundle: GameReleaseBundle,
): { rows: BuffBreakdownRow[]; unsupported: UnsupportedCharacterBuffs[] } {
  if (!evaluation) return { rows: [], unsupported: [] };
  const conditionalIds = new Set(evaluation.conditional.map(({ evaluationId }) => evaluationId));
  const rows = semanticEntryGroups(evaluation, bundle).map(({ targetType, entries }): BuffBreakdownRow => {
    const aggregate = aggregateEffects(entries);
    const group = aggregate.groups[0]!;
    const byMember = new Map<string, EvaluatedEffect[]>();
    for (const entry of entries) {
      const memberId = memberIdOf(entry.sourceInstanceId, build);
      if (!memberId) continue;
      const memberEntries = byMember.get(memberId) ?? [];
      memberEntries.push(entry);
      byMember.set(memberId, memberEntries);
    }
    const contributions = [...byMember.entries()].flatMap(([memberId, memberEntries]) => {
      const member = build.members.find((item, index) => (item.slotId ?? `slot-${index + 1}`) === memberId);
      if (!member) return [];
      const ownGroup = aggregateEffects(memberEntries).groups.find(({ id }) => id === group.id);
      if (!ownGroup) return [];
      return [{
        memberId, characterName: characterName(member.characterLogicalId, bundle),
        eidolon: member.eidolon, value: ownGroup.total,
      }];
    }).sort((left, right) => left.memberId.localeCompare(right.memberId));
    const supplied = combine(group.operation, contributions.map(({ value }) => value));
    const overlapWarning = aggregate.warnings.some((warning) => (
      warning.code === "stack_cap_exceeded"
      && warning.evaluationIds?.some((evaluationId) => group.evaluationIds.includes(evaluationId))
    ));
    const adjustmentLabel = group.operation === "override" && contributions.length > 1
      ? "取最高"
      : group.cap !== null && supplied - group.total > 1e-9 ? "已达到上限"
        : overlapWarning || Math.abs(supplied - group.total) > 1e-9 ? "叠加规则调整" : null;
    return {
      id: `${targetType ?? "unknown"}:${group.id}`,
      metricLabel: buffMetricLabels[group.metric] ?? group.metric,
      scopeLabel: scopeLabel(targetType),
      operation: group.operation,
      total: group.total,
      cap: group.cap,
      conditional: group.evaluationIds.some((evaluationId) => conditionalIds.has(evaluationId)),
      adjustmentLabel,
      contributions,
    };
  });

  const unsupportedByMember = new Map<string, Set<string>>();
  for (const entry of evaluation.unsupported) {
    const memberId = memberIdOf(entry.sourceInstanceId, build);
    const effect = bundle.entities.effects.find(({ id }) => id === entry.effectId);
    if (!memberId || !effect) continue;
    const labels = unsupportedByMember.get(memberId) ?? new Set<string>();
    labels.add(`${scopeLabel(effect.target.type)}${buffMetricLabels[entry.metric] ?? entry.metric}`);
    unsupportedByMember.set(memberId, labels);
  }
  const unsupported = [...unsupportedByMember.entries()].flatMap(([memberId, labels]) => {
    const member = build.members.find((item, index) => (item.slotId ?? `slot-${index + 1}`) === memberId);
    if (!member) return [];
    return [{
      memberId, characterName: characterName(member.characterLogicalId, bundle), eidolon: member.eidolon,
      labels: [...labels].sort(),
    }];
  }).sort((left, right) => left.memberId.localeCompare(right.memberId));
  return { rows, unsupported };
}

export function formatBuffValue(operation: Effect["operation"], value: number): string {
  const rounded = (number: number) => Math.round(number * 100) / 100;
  if (operation === "percent") return `${value >= 0 ? "+" : ""}${rounded(value * 100)}%`;
  if (operation === "multiplier") return `×${rounded(1 + value)}`;
  if (operation === "override") return `设为 ${rounded(value)}`;
  return `${value >= 0 ? "+" : ""}${rounded(value)}`;
}
