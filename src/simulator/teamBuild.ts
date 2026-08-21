import { z } from "zod";
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

export function encodeTeamBuild(build: TeamBuild): string {
  const result = TeamBuildSchema.safeParse(normalizedBuild(build));
  if (!result.success) throw new TeamBuildLinkError("构筑链接包含无法编码的数据。");
  return encodeURIComponent(JSON.stringify(result.data));
}

export function decodeTeamBuild(value: string): TeamBuild {
  try {
    const result = TeamBuildSchema.safeParse(JSON.parse(decodeURIComponent(value)));
    if (!result.success) throw new TeamBuildLinkError("构筑链接格式无效或包含旧版字段。");
    return normalizedBuild(result.data as TeamBuild);
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
  const parsed = TeamBuildSchema.safeParse(build);
  if (!parsed.success) throw new TeamBuildLinkError("构筑输入不符合当前数据结构。");
  const normalized = normalizedBuild(parsed.data as TeamBuild);
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
