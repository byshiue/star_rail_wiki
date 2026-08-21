import { z } from "zod";
import { CommunityPresetReferenceSchema } from "../domain/community";
import { EffectMetricSchema } from "../domain/effects";
import type { GameReleaseBundle } from "../domain/releases";
import {
  createEvaluationContext, TeamBuildValidationError,
  type TeamBuild, type TeamBuildIssue,
} from "../effects/context";

const LogicalIdSchema = z.string().min(1);
const RelicSetBuildSchema = z.strictObject({
  logicalId: LogicalIdSchema,
  pieces: z.number().int().min(1).max(6),
});
const TeamMemberBuildSchema = z.strictObject({
  slotId: z.string().min(1).optional(),
  characterLogicalId: LogicalIdSchema,
  eidolon: z.number().int().min(0).max(6),
  lightCone: z.strictObject({
    logicalId: LogicalIdSchema,
    superimposition: z.number().int().min(1).max(5),
  }).optional(),
  relicSets: z.array(RelicSetBuildSchema).max(3).optional(),
  consumableMetrics: z.array(EffectMetricSchema).optional(),
});
const TeamBuildSchema = z.strictObject({
  releaseId: z.string().min(1),
  members: z.array(TeamMemberBuildSchema).max(4),
  communityPreset: CommunityPresetReferenceSchema.optional(),
});

export class TeamBuildLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TeamBuildLinkError";
  }
}

function normalizedBuild(build: TeamBuild): TeamBuild {
  return {
    releaseId: build.releaseId,
    communityPreset: build.communityPreset ? {
      presetId: build.communityPreset.presetId,
      slots: [...build.communityPreset.slots] as typeof build.communityPreset.slots,
      investment: build.communityPreset.investment,
      requirements: [...build.communityPreset.requirements],
      substitutions: [...build.communityPreset.substitutions]
        .map((substitution) => ({ ...substitution }))
        .sort((left, right) => left.slot - right.slot
          || left.characterLogicalId.localeCompare(right.characterLogicalId)),
      memberAssumptions: build.communityPreset.memberAssumptions.map((assumption) => ({
        eidolon: assumption.eidolon,
        equipment: { ...assumption.equipment },
      })) as typeof build.communityPreset.memberAssumptions,
    } : undefined,
    members: [...build.members]
      .map((member) => ({
        slotId: member.slotId,
        characterLogicalId: member.characterLogicalId,
        eidolon: member.eidolon,
        lightCone: member.lightCone ? { ...member.lightCone } : undefined,
        relicSets: member.relicSets
          ? [...member.relicSets].map((set) => ({ ...set })).sort((a, b) => a.logicalId.localeCompare(b.logicalId))
          : undefined,
        consumableMetrics: member.consumableMetrics ? [...member.consumableMetrics].sort() : undefined,
      }))
      .sort((a, b) => (a.slotId ?? "").localeCompare(b.slotId ?? "")),
  };
}

function assertCommunityPresetConsistency(build: TeamBuild): void {
  const preset = build.communityPreset;
  if (!preset) return;
  const consistent = build.members.length === preset.slots.length && build.members.every((member, index) => {
    const assumption = preset.memberAssumptions[index];
    if (member.slotId !== `slot-${index + 1}` || member.characterLogicalId !== preset.slots[index]
      || member.eidolon !== assumption.eidolon || member.relicSets?.length
      || member.consumableMetrics?.length) return false;
    if (assumption.equipment.status === "none") return member.lightCone === undefined;
    return member.lightCone?.logicalId === assumption.equipment.logicalId
      && member.lightCone.superimposition === assumption.equipment.superimposition;
  });
  if (!consistent) throw new TeamBuildLinkError("构筑链接中的社区预设元数据与成员不一致。");
}

function parsedNormalizedBuild(value: unknown, message: string): TeamBuild {
  const parsed = TeamBuildSchema.safeParse(value);
  if (!parsed.success) throw new TeamBuildLinkError(message);
  const normalized = normalizedBuild(parsed.data as TeamBuild);
  assertCommunityPresetConsistency(normalized);
  return normalized;
}

export function encodeTeamBuild(build: TeamBuild): string {
  const normalized = parsedNormalizedBuild(build, "构筑链接包含无法编码的数据。");
  return encodeURIComponent(JSON.stringify(normalized));
}

export function decodeTeamBuild(value: string): TeamBuild {
  try {
    return parsedNormalizedBuild(
      JSON.parse(decodeURIComponent(value)), "构筑链接格式无效、包含旧版字段或元数据不一致。",
    );
  } catch (error) {
    if (error instanceof TeamBuildLinkError) throw error;
    throw new TeamBuildLinkError("构筑链接无法读取，请清除链接后重新构筑。");
  }
}

function activeCharacter(logicalId: string, bundle: GameReleaseBundle) {
  return bundle.entities.characters.find((character) => (
    character.logicalId === logicalId && character.validToReleaseId === null
  ));
}

function activeEquipment(logicalId: string, bundle: GameReleaseBundle) {
  return bundle.entities.equipment.find((equipment) => (
    equipment.logicalId === logicalId && equipment.validToReleaseId === null
  ));
}

export function validateTeamBuild(
  build: TeamBuild, bundle: GameReleaseBundle, options: { maxMembers?: number; label?: string } = {},
): TeamBuild {
  const normalized = parsedNormalizedBuild(build, "构筑输入不符合当前数据结构。");
  const issues: TeamBuildIssue[] = [];
  const maxMembers = options.maxMembers ?? 4;
  if (normalized.members.length > maxMembers) issues.push({
    code: "invalid_member_count", path: "members",
    message: `${options.label ?? "队伍"}最多允许 ${maxMembers} 名角色`,
  });
  const selectedCharacters = new Set<string>();
  for (const [index, member] of normalized.members.entries()) {
    const characterPath = `members[${index}].characterLogicalId`;
    if (selectedCharacters.has(member.characterLogicalId)) issues.push({
      code: "duplicate_character", path: characterPath,
      message: `character ${member.characterLogicalId} cannot appear twice in one team`,
    });
    selectedCharacters.add(member.characterLogicalId);
    const character = activeCharacter(member.characterLogicalId, bundle);
    if (!character || !member.lightCone) continue;
    const cone = activeEquipment(member.lightCone.logicalId, bundle);
    if (cone?.kind === "light-cone" && cone.pathRestriction !== null && cone.pathRestriction !== character.path) {
      issues.push({
        code: "illegal_equipment", path: `members[${index}].lightCone.logicalId`,
        message: `${cone.logicalId} is incompatible with ${character.logicalId}`,
      });
    }
  }
  try {
    createEvaluationContext(normalized, {}, bundle);
  } catch (error) {
    if (error instanceof TeamBuildValidationError) issues.push(...error.issues);
    else throw error;
  }
  if (issues.length) throw new TeamBuildValidationError(issues);
  return normalized;
}
