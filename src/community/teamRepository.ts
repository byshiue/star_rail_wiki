import { CommunityTeamLibrarySchema, type TeamPreset } from "../domain/community";
import type { GameReleaseBundle } from "../domain/releases";
import type { TeamBuild } from "../effects/evaluateTeam";
import { validateTeamBuild } from "../simulator/teamBuild";

async function fetchCommunityLibrary() {
  const response = await fetch(`${import.meta.env.BASE_URL}data/community/teams.json`);
  if (!response.ok) throw new Error(`Failed to fetch community teams (${response.status})`);
  return CommunityTeamLibrarySchema.parse(await response.json());
}

function stablePresets(presets: TeamPreset[]): TeamPreset[] {
  return structuredClone(presets).sort((left, right) => (
    left.releaseId.localeCompare(right.releaseId) || left.id.localeCompare(right.id)
  ));
}

export async function loadCommunityTeamLibrary(): Promise<TeamPreset[]> {
  return stablePresets((await fetchCommunityLibrary()).presets);
}

export async function loadCommunityTeams(releaseId: string): Promise<TeamPreset[]> {
  return stablePresets((await fetchCommunityLibrary()).presets.filter((preset) => preset.releaseId === releaseId));
}

export function validatePresetForBundle(preset: TeamPreset, bundle: GameReleaseBundle): string[] {
  const issues: string[] = [];
  if (preset.releaseId !== bundle.release.id) issues.push(`release ${preset.releaseId} does not match ${bundle.release.id}`);
  if (preset.gameVersion !== bundle.release.gameVersion) issues.push(
    `gameVersion ${preset.gameVersion} does not match ${bundle.release.gameVersion}`,
  );
  if (preset.channel !== bundle.release.channel) issues.push(
    `channel ${preset.channel} does not match ${bundle.release.channel}`,
  );
  if (preset.source.availability !== "available") issues.push("source is unavailable");
  const activeCharacters = new Set(bundle.entities.characters
    .filter((character) => character.validToReleaseId === null).map((character) => character.logicalId));
  for (const logicalId of [...preset.slots, ...preset.substitutions.map((item) => item.characterLogicalId)]) {
    if (!activeCharacters.has(logicalId)) issues.push(`unknown active character ${logicalId}`);
  }
  const activeEquipment = new Set(bundle.entities.equipment
    .filter((equipment) => equipment.kind === "light-cone" && equipment.validToReleaseId === null)
    .map((equipment) => equipment.logicalId));
  for (const assumption of preset.memberAssumptions) {
    if (assumption.equipment.status === "specified" && !activeEquipment.has(assumption.equipment.logicalId)) {
      issues.push(`unknown active equipment ${assumption.equipment.logicalId}`);
    }
  }
  return [...new Set(issues)].sort();
}

export function createTeamBuildFromPreset(preset: TeamPreset, bundle: GameReleaseBundle): TeamBuild {
  const presetIssues = validatePresetForBundle(preset, bundle);
  if (presetIssues.length) throw new Error(`community preset is not loadable: ${presetIssues.join("; ")}`);
  const build: TeamBuild = {
    releaseId: preset.releaseId,
    members: preset.slots.map((characterLogicalId, index) => ({
      slotId: `slot-${index + 1}`,
      characterLogicalId,
      eidolon: preset.memberAssumptions[index].eidolon,
      lightCone: preset.memberAssumptions[index].equipment.status === "specified" ? {
        logicalId: preset.memberAssumptions[index].equipment.logicalId,
        superimposition: preset.memberAssumptions[index].equipment.superimposition,
      } : undefined,
    })),
    communityPreset: {
      presetId: preset.id, investment: preset.investment,
      requirements: [...preset.requirements], substitutions: structuredClone(preset.substitutions),
      memberAssumptions: structuredClone(preset.memberAssumptions),
    },
  };
  return validateTeamBuild(build, bundle);
}
