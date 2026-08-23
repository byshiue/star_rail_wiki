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
  "ability:130302@4.4-cn-2026-08-21#residual-2": {
    "sourceRevisionId": "ability:130302@4.4-cn-2026-08-21",
    "originalText": "当阮•梅拥有【弦外音】时，我方全体伤害提高16.0%→40.0%，弱点击破效率提高50%",
    "id": "effect:4.4:130302-damage-bonus",
    "metric": "damage_bonus",
    "operation": "percent",
    "metricCorrection": {
      "from": "unclassified_numeric",
      "reason": "自动抽取把同句团队增伤与弱点击破效率合并；人工审核仅将可精确缩放的团队增伤部分建模。"
    },
    "target": {
      "type": "team"
    },
    "trigger": {
      "type": "event",
      "event": "skill:ability:130302"
    },
    "duration": {
      "type": "turns",
      "value": 3
    },
    "stacking": {
      "type": "refresh",
      "maxStacks": 1
    },
    "scalingEffectId": "effect:4.4:130302-damage-bonus"
  },
  "ability:130303@4.4-cn-2026-08-21#effect-1": {
    "sourceRevisionId": "ability:130303@4.4-cn-2026-08-21",
    "originalText": "处于结界中时我方全体全属性抗性穿透提高15.0%→30.0%，且攻击后会对敌方目标施加【残梅绽】",
    "id": "effect:4.4:130303-resistance-penetration",
    "target": {
      "type": "team"
    },
    "trigger": {
      "type": "event",
      "event": "ultimate:ability:130303"
    },
    "duration": {
      "type": "turns",
      "value": 2
    },
    "stacking": {
      "type": "refresh",
      "maxStacks": 1
    },
    "scalingEffectId": "effect:4.4:130303-resistance-penetration"
  },
  "ability:130304@4.4-cn-2026-08-21#effect-1": {
    "sourceRevisionId": "ability:130304@4.4-cn-2026-08-21",
    "originalText": "使除自身以外的队友速度提高8.0%→11.0%",
    "id": "effect:4.4:130304-team-speed",
    "target": {
      "type": "team-except-self"
    },
    "trigger": {
      "type": "always"
    },
    "duration": {
      "type": "permanent"
    },
    "stacking": {
      "type": "none",
      "maxStacks": 1
    },
    "scalingEffectId": "effect:4.4:130304-team-speed"
  },
  "trace:1303101@4.4-cn-2026-08-21#effect-1": {
    "sourceRevisionId": "trace:1303101@4.4-cn-2026-08-21",
    "originalText": "我方全体击破特攻提高20%。",
    "target": {
      "type": "team"
    },
    "trigger": {
      "type": "always"
    },
    "duration": {
      "type": "permanent"
    },
    "stacking": {
      "type": "none",
      "maxStacks": 1
    }
  },
  "eidolon:130301@4.4-cn-2026-08-21#effect-1": {
    "sourceRevisionId": "eidolon:130301@4.4-cn-2026-08-21",
    "originalText": "终结技展开结界期间，我方全体造成伤害时无视目标20%的防御力。",
    "target": {
      "type": "team"
    },
    "trigger": {
      "type": "event",
      "event": "ultimate:ability:130303"
    },
    "duration": {
      "type": "turns",
      "value": 2
    },
    "stacking": {
      "type": "refresh",
      "maxStacks": 1
    }
  },
  "eidolon:130302@4.4-cn-2026-08-21#effect-1": {
    "sourceRevisionId": "eidolon:130302@4.4-cn-2026-08-21",
    "originalText": "阮•梅在场时，我方全体对处于弱点击破状态的敌方目标造成伤害时，攻击力提高40%。",
    "target": {
      "type": "team"
    },
    "trigger": {
      "type": "always"
    },
    "duration": {
      "type": "permanent"
    },
    "stacking": {
      "type": "none",
      "maxStacks": 1
    },
    "conditions": [
      {
        "type": "enemy-broken",
        "operator": "equals",
        "value": true
      }
    ]
  },
  "ability:130602@4.4-cn-2026-08-21#effect-1": {
    "sourceRevisionId": "ability:130602@4.4-cn-2026-08-21",
    "originalText": "使指定我方单体的暴击伤害提高，提高数值等同于花火12.0%→30.0%暴击伤害+27.0%→54.0%，持续1回合，并使该目标行动提前50%",
    "target": {
      "type": "single-other-ally"
    },
    "trigger": {
      "type": "event",
      "event": "skill:ability:130602"
    },
    "duration": {
      "type": "instant"
    },
    "stacking": {
      "type": "none",
      "maxStacks": 1
    }
  },
  "ability:130603@4.4-cn-2026-08-21#effect-1": {
    "sourceRevisionId": "ability:130603@4.4-cn-2026-08-21",
    "originalText": "为我方恢复4个战技点，并使我方全体获得【谜诡】",
    "target": {
      "type": "team"
    },
    "trigger": {
      "type": "event",
      "event": "ultimate:ability:130603"
    },
    "duration": {
      "type": "instant"
    },
    "stacking": {
      "type": "none",
      "maxStacks": 1
    }
  },
  "ability:130604@4.4-cn-2026-08-21#effect-1": {
    "sourceRevisionId": "ability:130604@4.4-cn-2026-08-21",
    "originalText": "当我方目标每消耗1点战技点，则使我方全体造成的伤害提高3.0%→7.5%，该效果持续2回合，最多可叠加3层",
    "id": "effect:4.4:130604-team-damage",
    "target": {
      "type": "team"
    },
    "trigger": {
      "type": "event",
      "event": "skill-point-spent"
    },
    "duration": {
      "type": "turns",
      "value": 2
    },
    "stacking": {
      "type": "additive",
      "maxStacks": 3
    },
    "scalingEffectId": "effect:4.4:130604-team-damage"
  },
  "trace:1306103@4.4-cn-2026-08-21#effect-1": {
    "sourceRevisionId": "trace:1306103@4.4-cn-2026-08-21",
    "originalText": "我方全体的攻击力提高15%",
    "target": {
      "type": "team"
    },
    "trigger": {
      "type": "always"
    },
    "duration": {
      "type": "permanent"
    },
    "stacking": {
      "type": "none",
      "maxStacks": 1
    }
  },
  "eidolon:130601@4.4-cn-2026-08-21#effect-1": {
    "sourceRevisionId": "eidolon:130601@4.4-cn-2026-08-21",
    "originalText": "终结技施加的【谜诡】的持续时间额外增加1回合，持有【谜诡】的我方目标攻击力提高40%。",
    "target": {
      "type": "team"
    },
    "trigger": {
      "type": "event",
      "event": "ultimate:ability:130603"
    },
    "duration": {
      "type": "turns",
      "value": 3
    },
    "stacking": {
      "type": "refresh",
      "maxStacks": 1
    }
  },
  "eidolon:130602@4.4-cn-2026-08-21#effect-1": {
    "sourceRevisionId": "eidolon:130602@4.4-cn-2026-08-21",
    "originalText": "天赋每层效果额外使我方目标造成伤害时无视目标8%的防御力。",
    "target": {
      "type": "team"
    },
    "trigger": {
      "type": "event",
      "event": "skill-point-spent"
    },
    "duration": {
      "type": "turns",
      "value": 2
    },
    "stacking": {
      "type": "additive",
      "maxStacks": 3
    }
  },
  "ability:140302@4.4-cn-2026-08-21#effect-1": {
    "sourceRevisionId": "ability:140302@4.4-cn-2026-08-21",
    "originalText": "当缇宝拥有【神启】时，我方全体目标全属性抗性穿透提高12.0%→30.0%",
    "id": "effect:4.4:140302-resistance-penetration",
    "target": {
      "type": "team"
    },
    "trigger": {
      "type": "event",
      "event": "skill:ability:140302"
    },
    "duration": {
      "type": "turns",
      "value": 3
    },
    "stacking": {
      "type": "refresh",
      "maxStacks": 1
    },
    "scalingEffectId": "effect:4.4:140302-resistance-penetration"
  },
  "ability:140303@4.4-cn-2026-08-21#effect-1": {
    "sourceRevisionId": "ability:140303@4.4-cn-2026-08-21",
    "originalText": "结界持续期间，敌方目标受到的伤害提高15.0%→37.5%",
    "id": "effect:4.4:140303-vulnerability",
    "target": {
      "type": "all-enemies"
    },
    "trigger": {
      "type": "event",
      "event": "ultimate:ability:140303"
    },
    "duration": {
      "type": "turns",
      "value": 2
    },
    "stacking": {
      "type": "refresh",
      "maxStacks": 1
    },
    "scalingEffectId": "effect:4.4:140303-vulnerability"
  },
  "eidolon:140304@4.4-cn-2026-08-21#effect-1": {
    "sourceRevisionId": "eidolon:140304@4.4-cn-2026-08-21",
    "originalText": "【神启】持续期间，我方全体造成伤害时无视目标18%的防御力。",
    "target": {
      "type": "team"
    },
    "trigger": {
      "type": "event",
      "event": "skill:ability:140302"
    },
    "duration": {
      "type": "turns",
      "value": 3
    },
    "stacking": {
      "type": "refresh",
      "maxStacks": 1
    }
  },
  "ability:141503@4.4-cn-2026-08-21#effect-1": {
    "sourceRevisionId": "ability:141503@4.4-cn-2026-08-21",
    "originalText": "召唤忆灵德谬歌，使其立即获得1个额外回合并激活全体队友的终结技，随后进入【往昔的涟漪】状态，普攻强化为【向着爱与明天♪】且仅能使用该普攻，昔涟和德谬歌的暴击率提高25%→62.5%，展开战技的结界并使战技的结界没有持续时间",
    "id": "effect:4.4:141503-critical-rate",
    "target": {
      "type": "self"
    },
    "trigger": {
      "type": "event",
      "event": "ultimate:ability:141503"
    },
    "duration": {
      "type": "permanent"
    },
    "stacking": {
      "type": "refresh",
      "maxStacks": 1
    },
    "scalingEffectId": "effect:4.4:141503-critical-rate"
  },
  "ability:141504@4.4-cn-2026-08-21#effect-1": {
    "sourceRevisionId": "ability:141504@4.4-cn-2026-08-21",
    "originalText": "昔涟在场时，我方全体目标造成的伤害提高10.0%→25.0%",
    "id": "effect:4.4:141504-team-damage",
    "target": {
      "type": "team"
    },
    "trigger": {
      "type": "always"
    },
    "duration": {
      "type": "permanent"
    },
    "stacking": {
      "type": "none",
      "maxStacks": 1
    },
    "scalingEffectId": "effect:4.4:141504-team-damage"
  },
  "ability:1141502@4.4-cn-2026-08-21#effect-1": {
    "sourceRevisionId": "ability:1141502@4.4-cn-2026-08-21",
    "originalText": "当该角色不是黄金裔时，使其造成的伤害提高20%→56%，持续2回合，该效果对其忆灵也生效",
    "target": {
      "type": "single-ally"
    },
    "trigger": {
      "type": "event",
      "event": "memosprite-skill:ability:1141502"
    },
    "duration": {
      "type": "turns",
      "value": 2
    },
    "stacking": {
      "type": "refresh",
      "maxStacks": 1
    },
    "conditions": [
      {
        "type": "target-is-non-chrysos-heir",
        "operator": "equals",
        "value": true
      }
    ],
    "scalingEffectId": "effect:4.4:0812"
  },
  "ability:1141525@4.4-cn-2026-08-21#effect-1": {
    "sourceRevisionId": "ability:1141525@4.4-cn-2026-08-21",
    "originalText": "当丹恒•腾荒持有【献予「大地」之诗】时，【同袍】造成的伤害提高12.0%→33.6%",
    "target": {
      "type": "single-ally"
    },
    "trigger": {
      "type": "event",
      "event": "memosprite-skill:ability:1141525"
    },
    "duration": {
      "type": "permanent"
    },
    "stacking": {
      "type": "refresh",
      "maxStacks": 1
    },
    "scalingEffectId": "effect:4.4:0827"
  },
  "trace:1415103@4.4-cn-2026-08-21#effect-1": {
    "sourceRevisionId": "trace:1415103@4.4-cn-2026-08-21",
    "originalText": "昔涟的速度大于等于180点时，我方全体造成的伤害提高20%，之后每超过1点速度，昔涟与德谬歌的冰属性抗性穿透提高2%，最多计入60点超出的速度。",
    "target": {
      "type": "team"
    },
    "trigger": {
      "type": "always"
    },
    "duration": {
      "type": "permanent"
    },
    "stacking": {
      "type": "none",
      "maxStacks": 1
    },
    "conditions": [
      {
        "type": "speed",
        "operator": "at-least",
        "value": 180
      }
    ]
  },
  "eidolon:141506@4.4-cn-2026-08-21#effect-1": {
    "sourceRevisionId": "eidolon:141506@4.4-cn-2026-08-21",
    "originalText": "昔涟首次施放终结技时，使我方全体行动提前100%",
    "target": {
      "type": "team"
    },
    "trigger": {
      "type": "event",
      "event": "cyrene-first-ultimate"
    },
    "duration": {
      "type": "instant"
    },
    "stacking": {
      "type": "none",
      "maxStacks": 1
    }
  },
  "eidolon:141506@4.4-cn-2026-08-21#effect-2": {
    "sourceRevisionId": "eidolon:141506@4.4-cn-2026-08-21",
    "originalText": "1次：德谬歌在场时，敌方全体目标的防御力降低20%",
    "target": {
      "type": "all-enemies"
    },
    "trigger": {
      "type": "always"
    },
    "duration": {
      "type": "permanent"
    },
    "stacking": {
      "type": "none",
      "maxStacks": 1
    },
    "conditions": [
      {
        "type": "demiurge-present",
        "operator": "equals",
        "value": true
      },
      {
        "type": "cyrene-memosprite-skill-count",
        "operator": "at-least",
        "value": 1
      }
    ]
  },
  "eidolon:141506@4.4-cn-2026-08-21#effect-3": {
    "sourceRevisionId": "eidolon:141506@4.4-cn-2026-08-21",
    "originalText": "至少2次：使我方全体行动提前24%",
    "target": {
      "type": "team"
    },
    "trigger": {
      "type": "event",
      "event": "cyrene-memosprite-skill-twice"
    },
    "duration": {
      "type": "instant"
    },
    "stacking": {
      "type": "none",
      "maxStacks": 1
    }
  },
  "trace:1414102@4.4-cn-2026-08-21#effect-1": {
    "sourceRevisionId": "trace:1414102@4.4-cn-2026-08-21",
    "originalText": "战斗开始时，丹恒•腾荒行动提前40%",
    "target": {
      "type": "self"
    },
    "trigger": {
      "type": "battle-start"
    },
    "duration": {
      "type": "instant"
    },
    "stacking": {
      "type": "none",
      "maxStacks": 1
    }
  },
  "trace:1414102@4.4-cn-2026-08-21#effect-2": {
    "sourceRevisionId": "trace:1414102@4.4-cn-2026-08-21",
    "originalText": "【同袍】施放攻击时，丹恒•腾荒恢复6点能量，使【龙灵】行动提前15%",
    "target": {
      "type": "self"
    },
    "trigger": {
      "type": "event",
      "event": "buddy-attack"
    },
    "duration": {
      "type": "instant"
    },
    "stacking": {
      "type": "none",
      "maxStacks": 1
    }
  },
  "eidolon:141401@4.4-cn-2026-08-21#effect-1": {
    "sourceRevisionId": "eidolon:141401@4.4-cn-2026-08-21",
    "originalText": "丹恒•腾荒施放终结技时，恢复1个战技点，使【同袍】全属性抗性穿透提高18%，持续3回合。",
    "target": {
      "type": "team"
    },
    "trigger": {
      "type": "event",
      "event": "ultimate:ability:141403"
    },
    "duration": {
      "type": "instant"
    },
    "stacking": {
      "type": "none",
      "maxStacks": 1
    }
  },
  "eidolon:141401@4.4-cn-2026-08-21#effect-2": {
    "sourceRevisionId": "eidolon:141401@4.4-cn-2026-08-21",
    "originalText": "丹恒•腾荒施放终结技时，恢复1个战技点，使【同袍】全属性抗性穿透提高18%，持续3回合。",
    "target": {
      "type": "single-ally"
    },
    "trigger": {
      "type": "event",
      "event": "ultimate:ability:141403"
    },
    "duration": {
      "type": "turns",
      "value": 3
    },
    "stacking": {
      "type": "refresh",
      "maxStacks": 1
    }
  },
  "eidolon:141406@4.4-cn-2026-08-21#effect-1": {
    "sourceRevisionId": "eidolon:141406@4.4-cn-2026-08-21",
    "originalText": "场上存在【同袍】时，使敌方全体受到的伤害提高20%，【同袍】造成伤害时，无视敌方目标12%的防御力",
    "target": {
      "type": "all-enemies"
    },
    "trigger": {
      "type": "always"
    },
    "duration": {
      "type": "permanent"
    },
    "stacking": {
      "type": "none",
      "maxStacks": 1
    },
    "conditions": [
      {
        "type": "buddy-present",
        "operator": "equals",
        "value": true
      }
    ]
  },
  "eidolon:141406@4.4-cn-2026-08-21#residual-1": {
    "sourceRevisionId": "eidolon:141406@4.4-cn-2026-08-21",
    "originalText": "场上存在【同袍】时，使敌方全体受到的伤害提高20%，【同袍】造成伤害时，无视敌方目标12%的防御力",
    "id": "effect:4.4:141406-buddy-defense-ignore",
    "metric": "defense_ignore",
    "operation": "percent",
    "metricCorrection": {
      "from": "unclassified_numeric",
      "reason": "同句第二项经人工审核为【同袍】造成伤害时无视12%防御。"
    },
    "target": {
      "type": "single-ally"
    },
    "trigger": {
      "type": "always"
    },
    "duration": {
      "type": "permanent"
    },
    "stacking": {
      "type": "none",
      "maxStacks": 1
    },
    "conditions": [
      {
        "type": "buddy-present",
        "operator": "equals",
        "value": true
      }
    ]
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
