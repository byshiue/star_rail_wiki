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

function teamBuildFromPreset(preset: TeamPreset): TeamBuild {
  return {
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
      presetId: preset.id, slots: [...preset.slots], investment: preset.investment,
      requirements: [...preset.requirements], substitutions: structuredClone(preset.substitutions),
      memberAssumptions: structuredClone(preset.memberAssumptions),
    },
  };
}

export function validatePresetBuildForBundle(preset: TeamPreset, bundle: GameReleaseBundle): string[] {
  const issues: string[] = [];
  if (preset.releaseId !== bundle.release.id) issues.push(`release ${preset.releaseId} does not match ${bundle.release.id}`);
  if (preset.gameVersion !== bundle.release.gameVersion) issues.push(
    `gameVersion ${preset.gameVersion} does not match ${bundle.release.gameVersion}`,
  );
  if (preset.channel !== bundle.release.channel) issues.push(
    `channel ${preset.channel} does not match ${bundle.release.channel}`,
  );
  const activeCharacters = new Set(bundle.entities.characters
    .filter((character) => character.validToReleaseId === null).map((character) => character.logicalId));
  for (const substitution of preset.substitutions) {
    if (!activeCharacters.has(substitution.characterLogicalId)) {
      issues.push(`unknown active substitution character ${substitution.characterLogicalId}`);
    }
  }
  try {
    validateTeamBuild(teamBuildFromPreset(preset), bundle);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : "community preset build is invalid");
  }
  return [...new Set(issues)].sort();
}

export function validatePresetForBundle(preset: TeamPreset, bundle: GameReleaseBundle): string[] {
  const issues = validatePresetBuildForBundle(preset, bundle);
  if (preset.source.availability !== "available") issues.push("source is unavailable");
  return [...new Set(issues)].sort();
}

export function createTeamBuildFromPreset(preset: TeamPreset, bundle: GameReleaseBundle): TeamBuild {
  const buildIssues = validatePresetBuildForBundle(preset, bundle);
  if (buildIssues.length) throw new Error(`community preset is not loadable: ${buildIssues.join("; ")}`);
  return validateTeamBuild(teamBuildFromPreset(preset), bundle);
}
