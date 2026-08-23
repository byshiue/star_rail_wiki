import { z } from "zod";

export const ReviewStatusSchema = z.enum(["generated", "reviewed", "unsupported"]);
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;

export const EffectMetricSchema = z.enum([
  "attack", "hp", "defense", "speed", "critical_rate", "critical_damage",
  "break_effect", "effect_hit_rate", "effect_resistance", "energy",
  "damage_bonus", "vulnerability", "defense_reduction", "defense_ignore",
  "resistance_reduction", "resistance_penetration", "action_advance", "action_delay",
  "healing", "shielding", "skill_points", "mechanic_counter", "unclassified_numeric",
]);
export type EffectMetric = z.infer<typeof EffectMetricSchema>;

export const ScalingValueSchema = z.strictObject({
  base: z.number().finite(),
  scaling: z.array(z.number().finite()),
});
export type ScalingValue = z.infer<typeof ScalingValueSchema>;

export const TargetSelectorSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("self") }),
  z.strictObject({ type: z.literal("single-ally") }),
  z.strictObject({ type: z.literal("team") }),
  z.strictObject({
    type: z.literal("character-list"),
    characterLogicalIds: z.array(z.string().min(1)).min(1),
  }),
  z.strictObject({ type: z.literal("single-enemy") }),
  z.strictObject({ type: z.literal("all-enemies") }),
]);
export type TargetSelector = z.infer<typeof TargetSelectorSchema>;

export const TriggerExpressionSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("always") }),
  z.strictObject({ type: z.literal("battle-start") }),
  z.strictObject({ type: z.literal("action") }),
  z.strictObject({ type: z.literal("event"), event: z.string().min(1) }),
]);
export type TriggerExpression = z.infer<typeof TriggerExpressionSchema>;

export const DurationExpressionSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("permanent") }),
  z.strictObject({ type: z.literal("instant") }),
  z.strictObject({ type: z.literal("turns"), value: z.number().int().positive() }),
  z.strictObject({ type: z.literal("actions"), value: z.number().int().positive() }),
]);
export type DurationExpression = z.infer<typeof DurationExpressionSchema>;

export const StackingRuleSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("none"), maxStacks: z.literal(1) }),
  z.strictObject({ type: z.literal("additive"), maxStacks: z.number().int().positive() }),
  z.strictObject({ type: z.literal("refresh"), maxStacks: z.literal(1) }),
  z.strictObject({ type: z.literal("replace"), maxStacks: z.literal(1) }),
]);
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
