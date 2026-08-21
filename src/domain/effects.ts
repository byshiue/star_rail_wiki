import { z } from "zod";

export const ReviewStatusSchema = z.enum(["generated", "reviewed", "unsupported"]);
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;

export const EffectMetricSchema = z.enum([
  "attack", "hp", "defense", "speed", "critical_rate", "critical_damage",
  "break_effect", "effect_hit_rate", "effect_resistance", "energy",
  "damage_bonus", "vulnerability", "defense_reduction", "defense_ignore",
  "resistance_reduction", "resistance_penetration", "action_advance", "action_delay",
  "healing", "shielding", "skill_points", "mechanic_counter",
]);
export type EffectMetric = z.infer<typeof EffectMetricSchema>;

export const ScalingValueSchema = z.strictObject({
  base: z.number().finite(),
  scaling: z.array(z.number().finite()),
});
export type ScalingValue = z.infer<typeof ScalingValueSchema>;

export const TargetSelectorSchema = z.strictObject({
  type: z.enum(["self", "single-ally", "team", "single-enemy", "all-enemies"]),
});
export type TargetSelector = z.infer<typeof TargetSelectorSchema>;

export const TriggerExpressionSchema = z.strictObject({
  type: z.enum(["always", "battle-start", "action", "event"]),
  event: z.string().min(1).optional(),
});
export type TriggerExpression = z.infer<typeof TriggerExpressionSchema>;

export const DurationExpressionSchema = z.strictObject({
  type: z.enum(["permanent", "instant", "turns", "actions"]),
  value: z.number().int().positive().optional(),
});
export type DurationExpression = z.infer<typeof DurationExpressionSchema>;

export const StackingRuleSchema = z.strictObject({
  type: z.enum(["none", "additive", "refresh", "replace"]),
  maxStacks: z.number().int().positive(),
});
export type StackingRule = z.infer<typeof StackingRuleSchema>;

export const ConditionExpressionSchema = z.strictObject({
  type: z.string().min(1),
  operator: z.enum(["equals", "not-equals", "at-least", "at-most"]).optional(),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
});
export type ConditionExpression = z.infer<typeof ConditionExpressionSchema>;

export const EffectSchema = z.strictObject({
  id: z.string().min(1), sourceRevisionId: z.string().min(1), metric: EffectMetricSchema,
  operation: z.enum(["flat", "percent", "multiplier", "override"]),
  value: ScalingValueSchema, target: TargetSelectorSchema, trigger: TriggerExpressionSchema,
  duration: DurationExpressionSchema, stacking: StackingRuleSchema,
  conditions: z.array(ConditionExpressionSchema), dispellable: z.boolean().nullable(),
  reviewStatus: ReviewStatusSchema, originalText: z.string().min(1),
});
export type Effect = z.infer<typeof EffectSchema>;
