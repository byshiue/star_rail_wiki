import type { ReviewStatus, EffectMetric, ScalingValue, TargetSelector } from "../../src/domain/effects";

export interface EffectSourceRevision {
  revisionId: string;
  originalText?: string;
  description?: string;
}

export interface CandidateEffect {
  candidateId: string;
  sourceRevisionId: string;
  originalText: string;
  metric: EffectMetric;
  operation: "flat" | "percent";
  value: ScalingValue;
  target?: TargetSelector;
  reviewStatus: Extract<ReviewStatus, "generated">;
}

interface PhraseRule {
  pattern: RegExp;
  metric: EffectMetric;
  operation: CandidateEffect["operation"];
  target?: "enemy" | "ally";
}

const number = String.raw`(\d+(?:\.\d+)?)`;
const percent = String.raw`\s*(?:%|percent)`;
const rule = (pattern: string, metric: EffectMetric, operation: CandidateEffect["operation"] = "percent", target?: PhraseRule["target"]): PhraseRule => ({
  pattern: new RegExp(pattern, "giu"), metric, operation, target,
});

const rules: readonly PhraseRule[] = [
  rule(String.raw`(?:team\s+damage\s+bonus|damage\s+bonus(?:\s+increases?\s+by)?|[a-z]+\s+dmg\s+increases?\s+by|造成的伤害提高|(?:火|冰|雷|风|物理|量子|虚数)属性伤害提高)\s*${number}${percent}`, "damage_bonus"),
  rule(String.raw`(?:enemy\s+defense\s+reduction|防御力降低)\s*${number}${percent}`, "defense_reduction", "percent", "enemy"),
  rule(String.raw`(?:action\s+advance|行动提前)\s*${number}${percent}`, "action_advance", "percent", "ally"),
  rule(String.raw`(?:action\s+delay|行动延后)\s*${number}${percent}`, "action_delay", "percent", "enemy"),
  rule(String.raw`(?:攻击力提高|attack\s+increases?\s+by)\s*${number}${percent}`, "attack"),
  rule(String.raw`(?:生命值提高|(?:max\s+)?hp\s+increases?\s+by)\s*${number}${percent}`, "hp"),
  rule(String.raw`(?:防御力提高|defense\s+increases?\s+by)\s*${number}${percent}`, "defense"),
  rule(String.raw`(?:速度提高|speed\s+increases?\s+by)\s*${number}${percent}`, "speed"),
  rule(String.raw`速度提高\s*${number}\s*点`, "speed", "flat"),
  rule(String.raw`speed\s+increases?\s+by\s*${number}(?:\s+points?)?`, "speed", "flat"),
  rule(String.raw`(?:暴击率提高|critical\s+rate\s+increases?\s+by)\s*${number}${percent}`, "critical_rate"),
  rule(String.raw`(?:暴击伤害提高|critical\s+damage\s+increases?\s+by)\s*${number}${percent}`, "critical_damage"),
  rule(String.raw`(?:击破特攻提高|break\s+effect\s+increases?\s+by)\s*${number}${percent}`, "break_effect"),
  rule(String.raw`(?:效果命中提高|effect\s+hit\s+rate\s+increases?\s+by)\s*${number}${percent}`, "effect_hit_rate"),
  rule(String.raw`(?:效果抵抗提高|effect\s+resistance\s+increases?\s+by)\s*${number}${percent}`, "effect_resistance"),
  rule(String.raw`(?:能量恢复效率提高|energy\s+regeneration\s+rate\s+increases?\s+by)\s*${number}${percent}`, "energy"),
  rule(String.raw`(?:额外)?恢复\s*${number}\s*点能量`, "energy", "flat"),
  rule(String.raw`(?:受到的伤害提高|vulnerability(?:\s+increases?\s+by)?)\s*${number}${percent}`, "vulnerability", "percent", "enemy"),
  rule(String.raw`无视(?:目标)?\s*${number}${percent}\s*的?防御力`, "defense_ignore"),
  rule(String.raw`defense\s+ignore\s*${number}${percent}`, "defense_ignore"),
  rule(String.raw`(?:all\s+resistance\s+reduction|抗性降低)\s*${number}${percent}`, "resistance_reduction", "percent", "enemy"),
  rule(String.raw`(?:全属性抗性穿透提高|resistance\s+penetration(?:\s+increases?\s+by)?)\s*${number}${percent}`, "resistance_penetration"),
  rule(String.raw`(?:治疗量提高|healing\s+increases?\s+by)\s*${number}${percent}`, "healing"),
  rule(String.raw`(?:护盾量提高|shield(?:ing)?\s+increases?\s+by)\s*${number}${percent}`, "shielding"),
  rule(String.raw`(?:恢复|gain)\s*${number}\s*(?:个?战技点|skill\s+points?)`, "skill_points", "flat"),
  rule(String.raw`(?:获得|gain)\s*${number}\s*(?:层计数|counter\s+stacks?)`, "mechanic_counter", "flat"),
];

function targetFor(rule: PhraseRule, text: string): TargetSelector | undefined {
  if (rule.target === "enemy") return { type: "all-enemies" };
  if (/team|我方全体/i.test(text)) return { type: "team" };
  if (/self|装备者|自身/i.test(text)) return { type: "self" };
  if (rule.target === "ally") return { type: "single-ally" };
  return undefined;
}

export function extractCandidateEffects(entity: EffectSourceRevision): CandidateEffect[] {
  const sourceText = entity.originalText ?? entity.description;
  if (!sourceText) return [];

  const matches: Array<{ segmentIndex: number; index: number; ruleIndex: number; segment: string; rule: PhraseRule; value: number }> = [];
  const segments = sourceText.split(/[。；;\n]+/).map((segment) => segment.trim()).filter(Boolean);
  for (const [segmentIndex, segment] of segments.entries()) {
    for (const [ruleIndex, phraseRule] of rules.entries()) {
      phraseRule.pattern.lastIndex = 0;
      for (const match of segment.matchAll(phraseRule.pattern)) {
        const value = Number(match[1]);
        if (Number.isFinite(value)) matches.push({ segmentIndex, index: match.index, ruleIndex, segment, rule: phraseRule, value });
      }
    }
  }
  matches.sort((left, right) => (
    left.segmentIndex - right.segmentIndex || left.index - right.index || left.ruleIndex - right.ruleIndex
  ));

  return matches.map((match, index) => ({
    candidateId: `${entity.revisionId}#effect-${index + 1}`,
    sourceRevisionId: entity.revisionId,
    originalText: segments.length === 1 ? sourceText : match.segment,
    metric: match.rule.metric,
    operation: match.rule.operation,
    value: { base: match.rule.operation === "percent" ? match.value / 100 : match.value, scaling: [] },
    target: targetFor(match.rule, match.segment),
    reviewStatus: "generated",
  }));
}
