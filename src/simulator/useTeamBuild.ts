import { useEffect, useMemo, useState } from "react";
import type { GameReleaseBundle } from "../domain/releases";
import {
  evaluateTeam,
  type BattleScenario, type FiredThisEvaluation, type TeamBuild, type TeamEvaluation, type TeamMemberBuild,
} from "../effects/evaluateTeam";
import { validateTeamBuild } from "./teamBuild";

export type TeamBuildState = {
  build: TeamBuild;
  evaluation: TeamEvaluation | null;
  validationError: Error | null;
  updateMember: (slot: number, update: Partial<TeamMemberBuild> | null) => void;
  replaceBuild: (build: TeamBuild) => void;
  clear: () => void;
  evaluateOnce: (fired: FiredThisEvaluation) => void;
};

export function useTeamBuild(
  bundle: GameReleaseBundle, scenario: BattleScenario, initialBuild?: TeamBuild, maxMembers = 4,
): TeamBuildState {
  const emptyBuild = useMemo<TeamBuild>(() => ({ releaseId: bundle.release.id, members: [] }), [bundle.release.id]);
  const [build, setBuild] = useState<TeamBuild>(initialBuild ?? emptyBuild);
  const [oneShotEvaluation, setOneShotEvaluation] = useState<TeamEvaluation | null>(null);
  const result = useMemo(() => {
    if (build.members.length === 0) return { evaluation: null, validationError: null };
    try {
      const validBuild = validateTeamBuild(build, bundle, { maxMembers });
      return { evaluation: evaluateTeam(validBuild, scenario, bundle), validationError: null };
    } catch (error) {
      return { evaluation: null, validationError: error instanceof Error ? error : new Error("构筑验证失败") };
    }
  }, [build, bundle, scenario, maxMembers]);

  useEffect(() => {
    setOneShotEvaluation(null);
  }, [scenario]);

  function updateMember(slot: number, update: Partial<TeamMemberBuild> | null) {
    setOneShotEvaluation(null);
    const slotId = `slot-${slot}`;
    setBuild((current) => {
      const existing = current.members.find((member) => member.slotId === slotId);
      const others = current.members.filter((member) => member.slotId !== slotId);
      if (update === null) return { ...current, communityPreset: undefined, members: others };
      const member: TeamMemberBuild = {
        slotId,
        characterLogicalId: update.characterLogicalId ?? existing?.characterLogicalId ?? "",
        eidolon: update.eidolon ?? existing?.eidolon ?? 0,
        lightCone: Object.prototype.hasOwnProperty.call(update, "lightCone") ? update.lightCone : existing?.lightCone,
        relicSets: Object.prototype.hasOwnProperty.call(update, "relicSets") ? update.relicSets : existing?.relicSets,
      };
      return {
        ...current, communityPreset: undefined,
        members: [...others, member].sort((a, b) => (a.slotId ?? "").localeCompare(b.slotId ?? "")),
      };
    });
  }

  function replaceBuild(nextBuild: TeamBuild) {
    setOneShotEvaluation(null);
    setBuild(nextBuild);
  }

  function clear() {
    setOneShotEvaluation(null);
    setBuild(emptyBuild);
  }

  function evaluateOnce(firedThisEvaluation: FiredThisEvaluation) {
    if (build.members.length === 0) {
      setOneShotEvaluation(null);
      return;
    }
    try {
      const validBuild = validateTeamBuild(build, bundle, { maxMembers });
      setOneShotEvaluation(evaluateTeam(validBuild, { ...scenario, firedThisEvaluation }, bundle));
    } catch {
      setOneShotEvaluation(null);
    }
  }

  return {
    build, evaluation: oneShotEvaluation ?? result.evaluation, validationError: result.validationError,
    updateMember, replaceBuild, clear, evaluateOnce,
  };
}
