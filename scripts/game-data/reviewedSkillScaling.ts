import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { EffectSchema, type ScalingValue } from "../../src/domain/effects";
import { ApprovedSourceManifestSchema } from "./sourceManifest";

const SourcePath = "index_new/cn/character_skills.json";
const SourceChecksum = "sha256:185e33bcf884c7e576ff0142f1c88d4a99669f4c789232473a362eb8b0b2babf";
const ReviewedRecordsChecksum = "e7b3599f6012a494a26c3f9e9e45201141abf341e7953245bce41b49bbfce5e5";
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
  records: z.array(ReviewedSkillScalingRecordSchema).length(5),
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
      || skill.max_level !== 15 || skill.params.length !== skill.max_level
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
