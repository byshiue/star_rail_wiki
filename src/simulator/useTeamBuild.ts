import { useMemo, useState } from "react";
import type { GameReleaseBundle } from "../domain/releases";
import {
  evaluateTeam,
  type BattleScenario, type TeamBuild, type TeamEvaluation, type TeamMemberBuild,
} from "../effects/evaluateTeam";
import { validateTeamBuild } from "./teamBuild";

export type TeamBuildState = {
  build: TeamBuild;
  evaluation: TeamEvaluation | null;
  validationError: Error | null;
  updateMember: (slot: number, update: Partial<TeamMemberBuild> | null) => void;
  replaceBuild: (build: TeamBuild) => void;
  clear: () => void;
};

export function useTeamBuild(
  bundle: GameReleaseBundle, scenario: BattleScenario, initialBuild?: TeamBuild,
): TeamBuildState {
  const emptyBuild = useMemo<TeamBuild>(() => ({ releaseId: bundle.release.id, members: [] }), [bundle.release.id]);
  const [build, setBuild] = useState<TeamBuild>(initialBuild ?? emptyBuild);
  const result = useMemo(() => {
    if (build.members.length === 0) return { evaluation: null, validationError: null };
    try {
      const validBuild = validateTeamBuild(build, bundle);
      return { evaluation: evaluateTeam(validBuild, scenario, bundle), validationError: null };
    } catch (error) {
      return { evaluation: null, validationError: error instanceof Error ? error : new Error("构筑验证失败") };
    }
  }, [build, bundle, scenario]);

  function updateMember(slot: number, update: Partial<TeamMemberBuild> | null) {
    const slotId = `slot-${slot}`;
    setBuild((current) => {
      const existing = current.members.find((member) => member.slotId === slotId);
      const others = current.members.filter((member) => member.slotId !== slotId);
      if (update === null) return { ...current, members: others };
      const member: TeamMemberBuild = {
        slotId,
        characterLogicalId: update.characterLogicalId ?? existing?.characterLogicalId ?? "",
        eidolon: update.eidolon ?? existing?.eidolon ?? 0,
        lightCone: Object.prototype.hasOwnProperty.call(update, "lightCone") ? update.lightCone : existing?.lightCone,
        relicSets: Object.prototype.hasOwnProperty.call(update, "relicSets") ? update.relicSets : existing?.relicSets,
      };
      return { ...current, members: [...others, member].sort((a, b) => (a.slotId ?? "").localeCompare(b.slotId ?? "")) };
    });
  }

  return {
    build, evaluation: result.evaluation, validationError: result.validationError,
    updateMember, replaceBuild: setBuild, clear: () => setBuild(emptyBuild),
  };
}
