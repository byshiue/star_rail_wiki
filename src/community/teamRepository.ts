import teamsJson from "../../data/community/teams.json";
import { CommunityTeamLibrarySchema, type TeamPreset } from "../domain/community";
import type { GameReleaseBundle } from "../domain/releases";
import type { TeamBuild } from "../effects/evaluateTeam";
import { validateTeamBuild } from "../simulator/teamBuild";

const library = CommunityTeamLibrarySchema.parse(teamsJson);

export async function loadCommunityTeamLibrary(): Promise<TeamPreset[]> {
  return structuredClone(library.presets);
}

export async function loadCommunityTeams(releaseId: string): Promise<TeamPreset[]> {
  return structuredClone(library.presets.filter((preset) => preset.releaseId === releaseId));
}

export function createTeamBuildFromPreset(preset: TeamPreset, bundle: GameReleaseBundle): TeamBuild {
  const build: TeamBuild = {
    releaseId: preset.releaseId,
    members: preset.slots.map((characterLogicalId, index) => ({
      slotId: `slot-${index + 1}`, characterLogicalId, eidolon: 0,
    })),
  };
  return validateTeamBuild(build, bundle);
}
