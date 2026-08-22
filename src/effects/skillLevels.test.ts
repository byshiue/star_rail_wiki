import { describe, expect, it } from "vitest";
import entities from "../../public/data/releases/4.4-cn-2026-08-21/entities.json";
import release from "../../public/data/releases/4.4-cn-2026-08-21/release.json";
import { GameReleaseBundleSchema } from "../domain/releases";
import { decodeTeamBuild, encodeTeamBuild, validateTeamBuild } from "../simulator/teamBuild";
import { evaluateTeam, TeamBuildValidationError, type TeamBuild } from "./evaluateTeam";

const bundle = GameReleaseBundleSchema.parse({ release, entities });
const members: TeamBuild["members"] = [
  { slotId: "slot-1", characterLogicalId: "character:1101", eidolon: 0 },
  { slotId: "slot-2", characterLogicalId: "character:1106", eidolon: 0 },
  { slotId: "slot-3", characterLogicalId: "character:1305", eidolon: 0 },
  { slotId: "slot-4", characterLogicalId: "character:1203", eidolon: 0 },
];
const scenario = {
  activeEvents: ["skill:ability:110102", "ultimate:ability:110603"],
  firedThisEvaluation: { events: ["skill:ability:110102", "ultimate:ability:110603"] },
  targetAssignments: { "effect:4.4:0412": "slot-4" },
};

function entry(result: ReturnType<typeof evaluateTeam>, id: string) {
  return [...result.active, ...result.conditional].find(({ effectId }) => effectId === id)!;
}

describe("member-owned reviewed skill levels", () => {
  it("uses and discloses level 1 by default", () => {
    const result = evaluateTeam({ releaseId: bundle.release.id, members }, scenario, bundle);
    expect(entry(result, "effect:4.4:0412")).toMatchObject({
      value: 0.33, evidence: { selectedLevel: 1, maximumLevel: 15, levelSelection: "default" },
    });
    expect(entry(result, "effect:4.4:0437")).toMatchObject({
      value: 0.3, evidence: { selectedLevel: 1, maximumLevel: 15, levelSelection: "default" },
    });
  });

  it("uses explicit level 15 for the owning member feature", () => {
    const selected = structuredClone(members);
    selected[0]!.skillLevels = { "ability:110102": 15 };
    selected[1]!.skillLevels = { "ability:110603": 15 };
    const result = evaluateTeam({ releaseId: bundle.release.id, members: selected }, scenario, bundle);
    expect(entry(result, "effect:4.4:0412")).toMatchObject({
      value: 0.825, evidence: { selectedLevel: 15, maximumLevel: 15, levelSelection: "explicit" },
    });
    expect(entry(result, "effect:4.4:0437")).toMatchObject({
      value: 0.45, evidence: { selectedLevel: 15, maximumLevel: 15, levelSelection: "explicit" },
    });
  });

  it.each([
    ["unknown", { "ability:stale": 1 }],
    ["cross-character", { "ability:110603": 1 }],
    ["non-integer", { "ability:110102": 1.5 }],
    ["too-low", { "ability:110102": 0 }],
    ["too-high", { "ability:110102": 16 }],
  ])("rejects %s member skill levels", (_label, skillLevels) => {
    const selected = structuredClone(members);
    selected[0]!.skillLevels = skillLevels;
    expect(() => validateTeamBuild({ releaseId: bundle.release.id, members: selected }, bundle))
      .toThrow(TeamBuildValidationError);
  });

  it("roundtrips a stable feature-level selection through the share payload", () => {
    const build: TeamBuild = {
      releaseId: bundle.release.id,
      members: [{ ...members[0]!, skillLevels: { "ability:110102": 15 } }],
    };
    expect(decodeTeamBuild(encodeTeamBuild(build))).toEqual(build);
  });
});
