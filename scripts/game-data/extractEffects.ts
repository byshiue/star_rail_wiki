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
  phrase: RegExp;
  metric: EffectMetric;
  operation: CandidateEffect["operation"];
  target: (text: string) => TargetSelector | undefined;
}

const teamOrSelf = (text: string): TargetSelector | undefined => {
  if (/team|我方全体/i.test(text)) return { type: "team" };
  if (/self|装备者|自身/i.test(text)) return { type: "self" };
  return undefined;
};

const rules: readonly PhraseRule[] = [
  { phrase: /team damage bonus|造成的伤害提高/i, metric: "damage_bonus", operation: "percent", target: teamOrSelf },
  { phrase: /enemy defense reduction|防御力降低/i, metric: "defense_reduction", operation: "percent", target: () => ({ type: "all-enemies" }) },
  { phrase: /action advance|行动提前/i, metric: "action_advance", operation: "percent", target: (text) => (
    /team|我方全体/i.test(text) ? { type: "team" } : { type: "single-ally" }
  ) },
  { phrase: /攻击力提高/i, metric: "attack", operation: "percent", target: teamOrSelf },
  { phrase: /抗性穿透提高/i, metric: "resistance_penetration", operation: "percent", target: teamOrSelf },
  { phrase: /能量恢复效率提高/i, metric: "energy", operation: "percent", target: teamOrSelf },
  { phrase: /恢复\s*\d+(?:\.\d+)?\s*点能量/i, metric: "energy", operation: "flat", target: teamOrSelf },
];

function numericValue(text: string, operation: CandidateEffect["operation"]): number | undefined {
  const pattern = operation === "percent" ? /(\d+(?:\.\d+)?)\s*%/ : /恢复\s*(\d+(?:\.\d+)?)\s*点能量/i;
  const token = pattern.exec(text)?.[1];
  if (token === undefined) return undefined;
  const value = Number(token);
  if (!Number.isFinite(value)) return undefined;
  return operation === "percent" ? value / 100 : value;
}

export function extractCandidateEffects(entity: EffectSourceRevision): CandidateEffect[] {
  const sourceText = entity.originalText ?? entity.description;
  if (!sourceText) return [];

  const candidates: CandidateEffect[] = [];
  const segments = sourceText.split(/[。；;\n]+/).map((segment) => segment.trim()).filter(Boolean);
  for (const segment of segments) {
    for (const rule of rules) {
      if (!rule.phrase.test(segment)) continue;
      const value = numericValue(segment, rule.operation);
      if (value === undefined) continue;
      candidates.push({
        candidateId: `${entity.revisionId}#effect-${candidates.length + 1}`,
        sourceRevisionId: entity.revisionId,
        originalText: segments.length === 1 ? sourceText : segment,
        metric: rule.metric,
        operation: rule.operation,
        value: { base: value, scaling: [] },
        target: rule.target(segment),
        reviewStatus: "generated",
      });
      break;
    }
  }
  return candidates;
}
