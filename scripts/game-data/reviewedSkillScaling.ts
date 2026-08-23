import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { EffectSchema, type ScalingValue } from "../../src/domain/effects";
import { ApprovedSourceManifestSchema } from "./sourceManifest";

const SourcePath = "index_new/cn/character_skills.json";
const SourceChecksum = "sha256:185e33bcf884c7e576ff0142f1c88d4a99669f4c789232473a362eb8b0b2babf";
const ReviewedRecordsChecksum = "05c0a88149484bb9e50c6adfa657e801480043c6a779cc781f0558e5dffbc99b";
const definitions = [
  {
    sourceRecordId: "110102", featureLogicalId: "ability:110102", effectId: "effect:4.4:0412",
    parameterColumn: 1,
    descriptionTemplate: "解除指定我方单体的1个负面效果，并使该目标立即行动，造成的伤害提高#1[i]%，持续#3[i]回合。\n当对自身施放该技能时，无法触发立即行动效果。",
  },
  {
    sourceRecordId: "110603", featureLogicalId: "ability:110603", effectId: "effect:4.4:0437",
    parameterColumn: 2,
    descriptionTemplate: "有#1[i]%的基础概率使敌方每个单体目标陷入【通解】状态，同时对敌方全体造成等同于佩拉#4[i]%攻击力的冰属性伤害。\n【通解】状态下，敌方目标防御力降低#2[i]%，持续#3[i]回合。",
  },
  {
    sourceRecordId: "101502", featureLogicalId: "ability:101502", effectId: "effect:4.4:0405",
    parameterColumn: 2,
    descriptionTemplate: "进入【回路连接】状态。对指定敌方单体造成等同于Archer#1[i]%攻击力的量子属性伤害。【回路连接】状态下施放战技后，本回合不会结束，并使Archer战技造成的伤害提高#2[i]%，该效果可以叠加#3[i]层，持续至退出【回路连接】状态。主动施放#5[i]次战技后或战技点不足以再次施放战技则退出【回路连接】状态。每个波次中的所有敌方目标被消灭后会退出【回路连接】状态。",
  },
  {
    sourceRecordId: "150803", featureLogicalId: "ability:150803", effectId: "effect:4.4:0865",
    parameterColumn: 5,
    descriptionTemplate: "对指定敌方单体造成等同于远坂凛#1[i]%攻击力的量子属性伤害，同时对其他敌方目标造成等同于远坂凛#2[i]%攻击力的量子属性伤害。施放时，为我方恢复#4[i]个战技点，并使敌方全体受到的伤害提高#5[i]%，持续#6[i]回合。",
  },
  {
    sourceRecordId: "150804", featureLogicalId: "ability:150804", effectId: "effect:4.4:0866",
    parameterColumn: 3,
    descriptionTemplate: "进入战斗时，获得#1[i]点【宝石能量】。我方目标消耗或恢复战技点时，使其暴击伤害提高#3[i]%，持续#2[i]回合，且每消耗或恢复1点战技点就使远坂凛获得1点【宝石能量】。若远坂凛持有的【宝石能量】大于等于#5[i]点或当前战技点大于等于#4[i]点，战技强化为【第二魔法实验】。",
  },
  {
    sourceRecordId: "130302", featureLogicalId: "ability:130302", effectId: "effect:4.4:130302-damage-bonus",
    parameterColumn: 1,
    descriptionTemplate: "施放战技后阮•梅获得【弦外音】，持续#3[i]回合，阮•梅每回合开始时持续回合数减1。当阮•梅拥有【弦外音】时，我方全体伤害提高#1[f1]%，弱点击破效率提高#2[i]%。",
  },
  {
    sourceRecordId: "130303", featureLogicalId: "ability:130303", effectId: "effect:4.4:130303-resistance-penetration",
    parameterColumn: 1,
    descriptionTemplate: "阮•梅展开结界，持续#2[i]回合，自身每回合开始时结界持续回合数减1。\n处于结界中时我方全体全属性抗性穿透提高#1[f1]%，且攻击后会对敌方目标施加【残梅绽】。\n【残梅绽】会在敌方目标尝试从弱点击破状态恢复时触发，延长目标的弱点击破状态并使其行动延后，延后数值等同于阮•梅#3[i]%的击破特攻+#4[i]%，并对其造成等同于阮•梅#5[i]%冰属性击破伤害的击破伤害。\n敌方目标从弱点击破状态恢复前不可被再次附加【残梅绽】。",
  },
  {
    sourceRecordId: "130304", featureLogicalId: "ability:130304", effectId: "effect:4.4:130304-team-speed",
    parameterColumn: 1,
    descriptionTemplate: "使除自身以外的队友速度提高#1[f1]%。我方全体击破敌方目标弱点时，阮•梅对其造成等同于自身#2[f1]%冰属性击破伤害的击破伤害。",
  },
  {
    sourceRecordId: "130604", featureLogicalId: "ability:130604", effectId: "effect:4.4:130604-team-damage",
    parameterColumn: 2,
    descriptionTemplate: "花火在场时，战技点上限额外增加#3[i]点。当我方目标每消耗1点战技点，则使我方全体造成的伤害提高#2[f1]%，该效果持续#1[i]回合，最多可叠加#4[i]层。",
  },
  {
    sourceRecordId: "140302", featureLogicalId: "ability:140302", effectId: "effect:4.4:140302-resistance-penetration",
    parameterColumn: 1,
    descriptionTemplate: "获得【神启】，持续#2[i]回合，自身每回合开始时持续回合数减1。当缇宝拥有【神启】时，我方全体目标全属性抗性穿透提高#1[f1]%。",
  },
  {
    sourceRecordId: "140303", featureLogicalId: "ability:140303", effectId: "effect:4.4:140303-vulnerability",
    parameterColumn: 2,
    descriptionTemplate: "开启结界，并对敌方全体造成等同于缇宝#1[i]%生命上限的量子属性伤害。\n结界持续期间，敌方目标受到的伤害提高#2[f1]%。受到我方目标攻击后，每有1名目标受到攻击，会对被攻击目标中当前生命值最高的目标造成1次等同于缇宝#3[f1]%生命上限的量子属性附加伤害。\n结界持续#4[i]回合，自身每回合开始时结界持续回合数减1。",
  },
  {
    sourceRecordId: "141503", featureLogicalId: "ability:141503", effectId: "effect:4.4:141503-critical-rate",
    parameterColumn: 3,
    descriptionTemplate: "召唤忆灵德谬歌，使其立即获得1个额外回合并激活全体队友的终结技，随后进入【往昔的涟漪】状态，普攻强化为【向着爱与明天♪】且仅能使用该普攻，昔涟和德谬歌的暴击率提高#3[i]%，展开战技的结界并使战技的结界没有持续时间。\n单场战斗中只能施放1次。德谬歌初始拥有等同于昔涟#1[i]%生命上限的生命上限。",
  },
  {
    sourceRecordId: "141504", featureLogicalId: "ability:141504", effectId: "effect:4.4:141504-team-damage",
    parameterColumn: 2,
    descriptionTemplate: "战斗开始时或昔涟行动后，我方任意状态的其他角色及其忆灵获得【未来】，持有【未来】的我方目标行动时消耗【未来】使昔涟获得#1[i]点【追忆】。昔涟在【追忆】达到#4[i]点时可激活终结技并解除自身所有负面效果，处于【往昔的涟漪】状态时在【追忆】达到#5[i]点时可激活终结技，达到上限后还可最多溢出至#3[i]点。昔涟在场时，我方全体目标造成的伤害提高#2[f1]%。",
  },
  {
    sourceRecordId: "1141502", featureLogicalId: "ability:1141502", effectId: "effect:4.4:0812",
    parameterColumn: 2,
    descriptionTemplate: "对指定我方单体角色施加增益效果。当该角色为黄金裔时，使其获得特殊效果。当该角色不是黄金裔时，使其造成的伤害提高#2[i]%，持续#3[i]回合，该效果对其忆灵也生效。",
  },
  {
    sourceRecordId: "1141525", featureLogicalId: "ability:1141525", effectId: "effect:4.4:0827",
    parameterColumn: 1,
    descriptionTemplate: "德谬歌施放忆灵技时，使丹恒•腾荒获得【献予「大地」之诗】，并使【龙灵】的下#3[i]次攻击造成等同于【同袍】护盾量#4[i]%的相应属性附加伤害。当丹恒•腾荒持有【献予「大地」之诗】时，【同袍】造成的伤害提高#1[f1]%。对丹恒•腾荒施放时，使龙灵行动提前100%，并使龙灵下一次行动时获得丹恒•腾荒终结技的强化效果、提供的护盾量为原护盾量的#5[i]%，不消耗丹恒•腾荒终结技的强化次数。",
  },
] as const;

const ReviewedSkillScalingRecordSchema = z.strictObject({
  sourceRecordId: z.string().regex(/^\d+$/),
  featureLogicalId: z.string().regex(/^ability:/),
  effectId: z.string().min(1),
  descriptionTemplate: z.string().min(1),
  maxLevel: z.number().int().positive(),
  parameterColumn: z.number().int().positive(),
  params: z.array(z.array(z.number().finite()).min(1)).min(1),
});

export const ReviewedSkillScalingSnapshotSchema = z.strictObject({
  schemaVersion: z.literal(1),
  releaseId: z.literal("4.4-cn-2026-08-21"),
  sourceRevision: z.literal("b95e75c7e1273d819d20c530c0b7e13a3ef19fb4"),
  sourcePath: z.literal(SourcePath),
  sourceChecksum: z.literal(SourceChecksum, {
    error: "source checksum must match the locked StarRailRes character_skills.json",
  }),
  records: z.array(ReviewedSkillScalingRecordSchema).length(15),
}).superRefine(({ records }, context) => {
  const checksum = createHash("sha256").update(JSON.stringify(records)).digest("hex");
  if (checksum !== ReviewedRecordsChecksum) context.addIssue({
    code: "custom", path: ["records"],
    message: `reviewed skill scaling drift: locked parameter records checksum changed (${checksum})`,
  });
});
export type ReviewedSkillScalingSnapshot = z.infer<typeof ReviewedSkillScalingSnapshotSchema>;

export function deriveReviewedSkillScaling(
  snapshot: ReviewedSkillScalingSnapshot, featureLogicalId: string, effectId?: string,
): ScalingValue {
  const parsed = ReviewedSkillScalingSnapshotSchema.parse(snapshot);
  const record = parsed.records.find((item) => (
    item.featureLogicalId === featureLogicalId && (effectId === undefined || item.effectId === effectId)
  ));
  if (!record) throw new Error(`unknown reviewed scaling feature ${featureLogicalId}${effectId ? ` for ${effectId}` : ""}`);
  if (record.params.length !== record.maxLevel) throw new Error(`reviewed scaling row count drift: ${featureLogicalId}`);
  const values = record.params.map((row, index) => {
    const value = row[record.parameterColumn - 1];
    if (value === undefined) throw new Error(`reviewed scaling parameter column drift: ${featureLogicalId} level ${index + 1}`);
    return value;
  });
  return { base: values[0]!, scaling: values.slice(1) };
}

export function assertReviewedSkillScalingEffects(
  snapshot: ReviewedSkillScalingSnapshot, effectValues: readonly unknown[],
): void {
  const effects = z.array(EffectSchema).parse(effectValues);
  for (const record of snapshot.records) {
    const effect = effects.find(({ id }) => id === record.effectId);
    const expected = deriveReviewedSkillScaling(snapshot, record.featureLogicalId, record.effectId);
    if (!effect || effect.sourceRevisionId !== `${record.featureLogicalId}@${snapshot.releaseId}`
      || JSON.stringify(effect.value) !== JSON.stringify(expected)) {
      throw new Error(`reviewed skill scaling drift: ${record.featureLogicalId}`);
    }
  }
}

type RawSkill = { id: string; desc: string; max_level: number; params: number[][] };

export async function createReviewedSkillScalingSnapshot(
  sourceFile: string, manifestFile: string,
): Promise<ReviewedSkillScalingSnapshot> {
  const manifest = ApprovedSourceManifestSchema.parse(JSON.parse(await readFile(manifestFile, "utf8")));
  if (manifest.releaseId !== "4.4-cn-2026-08-21") throw new Error("reviewed scaling manifest release drift");
  const source = manifest.sources.find(({ revision }) => revision === "b95e75c7e1273d819d20c530c0b7e13a3ef19fb4");
  if (!source) throw new Error("reviewed scaling source revision drift");
  const bytes = await readFile(sourceFile);
  const checksum = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (source.fileChecksums[SourcePath] !== checksum) throw new Error("reviewed scaling source checksum drift");
  const raw = JSON.parse(bytes.toString("utf8")) as Record<string, RawSkill>;
  const records = definitions.map((definition) => {
    const skill = raw[definition.sourceRecordId];
    if (!skill || skill.id !== definition.sourceRecordId || skill.desc !== definition.descriptionTemplate
      || skill.max_level !== (definition.sourceRecordId.startsWith("11415") ? 10 : 15) || skill.params.length !== skill.max_level
      || skill.params.some((row) => !Number.isFinite(row[definition.parameterColumn - 1]))) {
      throw new Error(`reviewed scaling locked record drift: ${definition.sourceRecordId}`);
    }
    return { ...definition, maxLevel: skill.max_level, params: skill.params };
  });
  return ReviewedSkillScalingSnapshotSchema.parse({
    schemaVersion: 1, releaseId: manifest.releaseId, sourceRevision: source.revision,
    sourcePath: SourcePath, sourceChecksum: checksum, records,
  });
}

async function main(): Promise<void> {
  const snapshot = await createReviewedSkillScalingSnapshot(process.argv[2]!, process.argv[3]!);
  await writeFile(process.argv[4]!, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
