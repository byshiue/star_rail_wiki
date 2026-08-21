import type { Effect } from "../../domain/effects";
import type { GameReleaseBundle } from "../../domain/releases";
import entities from "../../../data/fixtures/release-4.3/entities.json";
import release from "../../../data/fixtures/release-4.3/release.json";
import type { BattleScenario, TeamBuild } from "../context";

const sourceRevisionId = "ability:synthetic-support-skill@4.3-fixture";
const baseEffect = entities.effects[0] as Effect;

function effect(id: string, changes: Partial<Effect>): Effect {
  return { ...baseEffect, id, sourceRevisionId, ...changes };
}

export const fixtureBundle: GameReleaseBundle = {
  release: release as GameReleaseBundle["release"],
  entities: {
    ...entities,
    effects: [
      effect("effect:damage", { value: { base: 0.5, scaling: [] } }),
      effect("effect:vulnerability", {
        metric: "vulnerability", value: { base: 0.2, scaling: [] },
        target: { type: "all-enemies" },
      }),
      effect("effect:broken", {
        metric: "critical_damage", value: { base: 0.1, scaling: [] },
        conditions: [{ type: "enemy-broken" }],
      }),
      effect("effect:event", {
        metric: "attack", value: { base: 0.2, scaling: [] },
        trigger: { type: "event", event: "skill-active" },
        duration: { type: "turns", value: 2 },
      }),
      effect("effect:stacks", {
        metric: "speed", operation: "flat", value: { base: 10, scaling: [] },
        stacking: { type: "additive", maxStacks: 2 },
      }),
      effect("effect:unsupported", { reviewStatus: "unsupported" }),
      effect("effect:generated", { reviewStatus: "generated" }),
    ],
  } as GameReleaseBundle["entities"],
};

export const goldenTeam: TeamBuild = {
  releaseId: "4.3-fixture",
  members: [
    { slotId: "slot-1", characterLogicalId: "character:synthetic-support", eidolon: 0 },
    { slotId: "slot-2", characterLogicalId: "character:synthetic-support", eidolon: 0 },
    { slotId: "slot-3", characterLogicalId: "character:synthetic-support", eidolon: 0 },
    { slotId: "slot-4", characterLogicalId: "character:synthetic-support", eidolon: 0 },
  ],
};

export const allConditionsActive: BattleScenario = {
  enemyBroken: true,
  activeEvents: ["skill-active"],
  firedThisEvaluation: { events: ["skill-active"] },
  stacks: { "effect:stacks": 5 },
};
