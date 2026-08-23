import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import type { ConditionExpression, EffectMetric, ScalingValue } from "../../src/domain/effects";
import { EffectOverlayFileSchema, type EffectOverlay } from "./applyEffectOverlays";
import {
  deriveReviewedSkillScaling, ReviewedSkillScalingSnapshotSchema,
} from "./reviewedSkillScaling";

type ReviewedEffect = {
  sourceRevisionId: string;
  originalText: string;
  id?: string;
  metricCorrection?: EffectOverlay["metricCorrection"];
  target: EffectOverlay["target"];
  trigger: EffectOverlay["trigger"];
  duration: EffectOverlay["duration"];
  stacking: EffectOverlay["stacking"];
  metric?: EffectMetric;
  operation?: EffectOverlay["operation"];
  value?: ScalingValue;
  conditions?: ConditionExpression[];
  scalingEffectId?: string;
};

const reviewed: Record<string, ReviewedEffect> = {
  "trace:1101103@4.4-cn-2026-08-21#effect-1": {
    sourceRevisionId: "trace:1101103@4.4-cn-2026-08-21",
    originalText: "布洛妮娅在场时，我方全体造成的伤害提高10%。",
    target: { type: "team" }, trigger: { type: "always" }, duration: { type: "permanent" },
    stacking: { type: "none", maxStacks: 1 },
  },
  "ability:110102@4.4-cn-2026-08-21#effect-1": {
    sourceRevisionId: "ability:110102@4.4-cn-2026-08-21",
    originalText: "解除指定我方单体的1个负面效果，并使该目标立即行动，造成的伤害提高33%→82.5%，持续1回合",
    target: { type: "single-ally" }, trigger: { type: "event", event: "skill:ability:110102" },
    duration: { type: "turns", value: 1 }, stacking: { type: "refresh", maxStacks: 1 },
    scalingEffectId: "effect:4.4:0412",
  },
  "ability:110603@4.4-cn-2026-08-21#effect-1": {
    sourceRevisionId: "ability:110603@4.4-cn-2026-08-21",
    originalText: "【通解】状态下，敌方目标防御力降低30%→45%，持续2回合",
    target: { type: "all-enemies" }, trigger: { type: "event", event: "ultimate:ability:110603" },
    duration: { type: "turns", value: 2 }, stacking: { type: "refresh", maxStacks: 1 },
    scalingEffectId: "effect:4.4:0437",
  },

  "ability:101502@4.4-cn-2026-08-21#effect-1": {
    sourceRevisionId: "ability:101502@4.4-cn-2026-08-21",
    originalText: "【回路连接】状态下施放战技后，本回合不会结束，并使Archer战技造成的伤害提高60%→120%，该效果可以叠加2层，持续至退出【回路连接】状态",
    target: { type: "self" }, trigger: { type: "event", event: "archer-circuit-skill" },
    duration: { type: "permanent" }, stacking: { type: "additive", maxStacks: 2 },
    conditions: [{ type: "attack-type", operator: "equals", value: "skill" }],
    scalingEffectId: "effect:4.4:0405",
  },
  "ability:101504@4.4-cn-2026-08-21#effect-1": {
    sourceRevisionId: "ability:101504@4.4-cn-2026-08-21",
    originalText: "当Archer的队友对敌方目标施放攻击后，Archer消耗1点充能，立即对主目标发动追加攻击，造成等同于Archer100%→250%攻击力的量子属性伤害，并恢复1个战技点",
    target: { type: "team" }, trigger: { type: "event", event: "ally-attack" },
    duration: { type: "instant" }, stacking: { type: "none", maxStacks: 1 },
  },
  "trace:1015103@4.4-cn-2026-08-21#effect-1": {
    sourceRevisionId: "trace:1015103@4.4-cn-2026-08-21",
    originalText: "我方获得战技点后，若战技点大于等于4点，Archer的暴击伤害提高120%，持续1回合。",
    target: { type: "self" }, trigger: { type: "event", event: "skill-point-gained" },
    duration: { type: "turns", value: 1 }, stacking: { type: "refresh", maxStacks: 1 },
    conditions: [{ type: "skill-points", operator: "at-least", value: 4 }],
  },
  "eidolon:101501@4.4-cn-2026-08-21#effect-1": {
    sourceRevisionId: "eidolon:101501@4.4-cn-2026-08-21",
    originalText: "单个回合内施放3次战技后，为我方恢复2个战技点。",
    target: { type: "team" }, trigger: { type: "event", event: "archer-third-skill" },
    duration: { type: "instant" }, stacking: { type: "none", maxStacks: 1 },
  },
  "eidolon:101502@4.4-cn-2026-08-21#effect-1": {
    sourceRevisionId: "eidolon:101502@4.4-cn-2026-08-21",
    originalText: "施放终结技时，使敌方目标的量子属性的抗性降低20%，并为其添加量子属性弱点，持续2回合。",
    target: { type: "all-enemies" }, trigger: { type: "event", event: "ultimate:ability:101503" },
    duration: { type: "turns", value: 2 }, stacking: { type: "refresh", maxStacks: 1 },
  },
  "eidolon:101504@4.4-cn-2026-08-21#residual-1": {
    sourceRevisionId: "eidolon:101504@4.4-cn-2026-08-21",
    originalText: "造成的终结技伤害提高150%",
    id: "effect:4.4:101504-ultimate-damage",
    metric: "damage_bonus", operation: "percent",
    metricCorrection: {
      from: "unclassified_numeric",
      reason: "自动抽取未识别终结技限定增伤；人工审核为150%自身终结技增伤。",
    },
    target: { type: "self" }, trigger: { type: "always" },
    duration: { type: "permanent" }, stacking: { type: "none", maxStacks: 1 },
    conditions: [{ type: "attack-type", operator: "equals", value: "ultimate" }],
  },
  "eidolon:101506@4.4-cn-2026-08-21#effect-1": {
    sourceRevisionId: "eidolon:101506@4.4-cn-2026-08-21",
    originalText: "回合开始时为我方恢复1个战技点",
    target: { type: "team" }, trigger: { type: "event", event: "turn-start:character:1015" },
    duration: { type: "instant" }, stacking: { type: "none", maxStacks: 1 },
  },
  "eidolon:101506@4.4-cn-2026-08-21#effect-2": {
    sourceRevisionId: "eidolon:101506@4.4-cn-2026-08-21",
    originalText: "造成的战技伤害无视20%的防御力",
    target: { type: "self" }, trigger: { type: "always" },
    duration: { type: "permanent" }, stacking: { type: "none", maxStacks: 1 },
    conditions: [{ type: "attack-type", operator: "equals", value: "skill" }],
  },

  "ability:150803@4.4-cn-2026-08-21#effect-1": {
    sourceRevisionId: "ability:150803@4.4-cn-2026-08-21",
    originalText: "施放时，为我方恢复1个战技点，并使敌方全体受到的伤害提高10%→25%，持续3回合",
    target: { type: "team" }, trigger: { type: "event", event: "ultimate:ability:150803" },
    duration: { type: "instant" }, stacking: { type: "none", maxStacks: 1 },
  },
  "ability:150803@4.4-cn-2026-08-21#effect-2": {
    sourceRevisionId: "ability:150803@4.4-cn-2026-08-21",
    originalText: "施放时，为我方恢复1个战技点，并使敌方全体受到的伤害提高10%→25%，持续3回合",
    target: { type: "all-enemies" }, trigger: { type: "event", event: "ultimate:ability:150803" },
    duration: { type: "turns", value: 3 }, stacking: { type: "refresh", maxStacks: 1 },
    scalingEffectId: "effect:4.4:0865",
  },
  "ability:150804@4.4-cn-2026-08-21#effect-1": {
    sourceRevisionId: "ability:150804@4.4-cn-2026-08-21",
    originalText: "我方目标消耗或恢复战技点时，使其暴击伤害提高35%→87.5%，持续2回合，且每消耗或恢复1点战技点就使远坂凛获得1点【宝石能量】",
    target: { type: "single-ally" }, trigger: { type: "event", event: "skill-point-changed" },
    duration: { type: "turns", value: 2 }, stacking: { type: "refresh", maxStacks: 1 },
    scalingEffectId: "effect:4.4:0866",
  },
  "ability:150805@4.4-cn-2026-08-21#effect-1": {
    sourceRevisionId: "ability:150805@4.4-cn-2026-08-21",
    originalText: "Archer施放战技【伪•螺旋剑】攻击后，若战技点小于等于3点或本次【回路连接】状态已主动施放5次【伪•螺旋剑】，且未触发【自在远坂流】的连携追加攻击，远坂凛和Archer对敌方全体发动连携追加攻击，分别造成等同于远坂凛150%→375%攻击力以及Archer150%→375%攻击力的量子属性伤害，并为我方恢复4个战技点",
    target: { type: "team" }, trigger: { type: "event", event: "rin-archer-coordinated-attack" },
    duration: { type: "instant" }, stacking: { type: "none", maxStacks: 1 },
  },
  "trace:1508101@4.4-cn-2026-08-21#effect-1": {
    sourceRevisionId: "trace:1508101@4.4-cn-2026-08-21",
    originalText: "进入战斗时，远坂凛的攻击力提高150%，量子属性抗性穿透提高15%，若Archer在队伍中，Archer也会获得该效果",
    target: { type: "character-list", characterLogicalIds: ["character:1015", "character:1508"] },
    trigger: { type: "battle-start" }, duration: { type: "permanent" },
    stacking: { type: "none", maxStacks: 1 },
  },
  "trace:1508101@4.4-cn-2026-08-21#residual-2": {
    sourceRevisionId: "trace:1508101@4.4-cn-2026-08-21",
    originalText: "进入战斗时，远坂凛的攻击力提高150%，量子属性抗性穿透提高15%，若Archer在队伍中，Archer也会获得该效果",
    id: "effect:4.4:1508101-resistance-penetration",
    metric: "resistance_penetration", operation: "percent",
    metricCorrection: {
      from: "unclassified_numeric",
      reason: "同句第二项经人工审核为远坂凛与Archer的15%量子属性抗性穿透。",
    },
    target: { type: "character-list", characterLogicalIds: ["character:1015", "character:1508"] },
    trigger: { type: "battle-start" }, duration: { type: "permanent" },
    stacking: { type: "none", maxStacks: 1 },
  },
  "trace:1508102@4.4-cn-2026-08-21#effect-1": {
    sourceRevisionId: "trace:1508102@4.4-cn-2026-08-21",
    originalText: "进入战斗时和施放强化战技后，远坂凛的速度提高20%，持续3回合。",
    target: { type: "self" }, trigger: { type: "event", event: "rin-speed-buff-activated" },
    duration: { type: "turns", value: 3 }, stacking: { type: "refresh", maxStacks: 1 },
  },
  "eidolon:150802@4.4-cn-2026-08-21#residual-1": {
    sourceRevisionId: "eidolon:150802@4.4-cn-2026-08-21",
    originalText: "远坂凛造成的战技伤害提高30%",
    id: "effect:4.4:150802-self-skill-damage",
    metric: "damage_bonus", operation: "percent",
    metricCorrection: {
      from: "unclassified_numeric",
      reason: "自动抽取未识别战技限定增伤；人工审核为远坂凛自身30%战技增伤。",
    },
    target: { type: "self" }, trigger: { type: "always" },
    duration: { type: "permanent" }, stacking: { type: "none", maxStacks: 1 },
    conditions: [{ type: "attack-type", operator: "equals", value: "skill" }],
  },
  "eidolon:150802@4.4-cn-2026-08-21#residual-2": {
    sourceRevisionId: "eidolon:150802@4.4-cn-2026-08-21",
    originalText: "远坂凛在场时，我方全体造成的战技伤害为原伤害的130%",
    id: "effect:4.4:150802-team-skill-damage",
    metric: "damage_bonus", operation: "percent", value: { base: 0.3, scaling: [] },
    metricCorrection: {
      from: "unclassified_numeric",
      reason: "原伤害130%经人工审核为全队30%战技增伤，而非130%加成。",
    },
    target: { type: "team" }, trigger: { type: "always" },
    duration: { type: "permanent" }, stacking: { type: "none", maxStacks: 1 },
    conditions: [{ type: "attack-type", operator: "equals", value: "skill" }],
  },
  "eidolon:150806@4.4-cn-2026-08-21#effect-1": {
    sourceRevisionId: "eidolon:150806@4.4-cn-2026-08-21",
    originalText: "远坂凛的全属性抗性穿透提高20%",
    target: { type: "self" }, trigger: { type: "always" },
    duration: { type: "permanent" }, stacking: { type: "none", maxStacks: 1 },
  },
};

export async function applyR4ReviewedEffects(
  file = "data/manual/effects.json",
  scalingFile = "data/releases/4.4-cn-2026-08-21/reviewed-skill-scaling.json",
): Promise<void> {
  const value = EffectOverlayFileSchema.parse(JSON.parse(await readFile(file, "utf8")));
  const scaling = ReviewedSkillScalingSnapshotSchema.parse(JSON.parse(await readFile(scalingFile, "utf8")));
  const found = new Set<string>();
  value.overlays = value.overlays.map((overlay) => {
    const review = reviewed[overlay.candidateId];
    if (!review) return overlay;
    if (overlay.sourceRevisionId !== review.sourceRevisionId || overlay.originalText !== review.originalText) {
      throw new Error(`reviewed candidate source/text drift: ${overlay.candidateId}`);
    }
    found.add(overlay.candidateId);
    const featureLogicalId = review.sourceRevisionId.split("@")[0]!;
    const reviewedValue = review.scalingEffectId
      ? deriveReviewedSkillScaling(scaling, featureLogicalId, review.scalingEffectId)
      : review.value ?? overlay.value;
    return EffectOverlayFileSchema.shape.overlays.element.parse({
      ...overlay,
      id: review.id ?? overlay.id,
      metric: review.metric ?? overlay.metric,
      metricCorrection: review.metricCorrection,
      operation: review.operation ?? overlay.operation,
      value: reviewedValue,
      target: review.target,
      trigger: review.trigger,
      duration: review.duration,
      stacking: review.stacking,
      conditions: review.conditions ?? [],
      dispellable: null,
      reviewStatus: "reviewed",
    });
  });
  if (found.size !== Object.keys(reviewed).length) throw new Error("not every R4 reviewed candidate exists");
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await applyR4ReviewedEffects();
