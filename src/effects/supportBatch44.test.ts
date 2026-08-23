import { describe, expect, it } from "vitest";
import entities from "../../public/data/releases/4.4-cn-2026-08-21/entities.json";
import release from "../../public/data/releases/4.4-cn-2026-08-21/release.json";
import { GameReleaseBundleSchema } from "../domain/releases";
import { buildBuffBreakdown } from "../simulator/teamBuffBreakdown";
import { evaluateTeam, type BattleScenario, type TeamBuild } from "./evaluateTeam";

const bundle = GameReleaseBundleSchema.parse({ release, entities });
const fillers = ["character:1101", "character:1106", "character:1305"];

function build(characterLogicalId: string, eidolon: number, skillLevels?: Record<string, number>): TeamBuild {
  return {
    releaseId: bundle.release.id,
    members: [characterLogicalId, ...fillers].map((logicalId, index) => ({
      slotId: `slot-${index + 1}`, characterLogicalId: logicalId,
      eidolon: index === 0 ? eidolon : 0,
      ...(index === 0 && skillLevels ? { skillLevels } : {}),
    })),
  };
}

function entry(result: ReturnType<typeof evaluateTeam>, effectId: string) {
  return [...result.active, ...result.conditional].find((item) => item.effectId === effectId);
}

function evaluate(characterLogicalId: string, eidolon: number, scenario: BattleScenario, skillLevels?: Record<string, number>) {
  const team = build(characterLogicalId, eidolon, skillLevels);
  const result = evaluateTeam(team, scenario, bundle);
  expect(buildBuffBreakdown(team, result, bundle).rows.length).toBeGreaterThan(0);
  return result;
}

describe("4.4 reviewed support buffs reach the simulator", () => {
  it("shows Ruan Mei team buffs and excludes herself from the speed target", () => {
    const result = evaluate("character:1303", 2, {
      battleStarted: true,
      enemyBroken: true,
      activeEvents: ["skill:ability:130302", "ultimate:ability:130303"],
      firedThisEvaluation: { events: ["skill:ability:130302", "ultimate:ability:130303"] },
    }, { "ability:130302": 15, "ability:130303": 15, "ability:130304": 15 });
    expect(entry(result, "effect:4.4:130302-damage-bonus")).toMatchObject({ value: 0.4, targets: ["slot-1", "slot-2", "slot-3", "slot-4"] });
    expect(entry(result, "effect:4.4:130303-resistance-penetration")).toMatchObject({ value: 0.3 });
    expect(entry(result, "effect:4.4:130304-team-speed")).toMatchObject({ value: 0.11, targets: ["slot-2", "slot-3", "slot-4"] });
    expect(entry(result, "effect:4.4:0618")).toMatchObject({ value: 0.4 });
  });

  it("shows Sparkle stack-scaled E2 team buffs without alternate-mode double counting", () => {
    const result = evaluate("character:1306", 2, {
      battleStarted: true,
      activeEvents: ["skill:ability:130602", "ultimate:ability:130603", "skill-point-spent"],
      firedThisEvaluation: { events: ["skill:ability:130602", "ultimate:ability:130603", "skill-point-spent"] },
      targetAssignments: { "effect:4.4:0632": "slot-2" },
      stacks: { "effect:4.4:130604-team-damage": 3, "effect:4.4:0646": 3 },
    }, { "ability:130604": 15 });
    expect(entry(result, "effect:4.4:130604-team-damage")).toMatchObject({ stacks: 3 });
    expect(entry(result, "effect:4.4:130604-team-damage")?.value).toBeCloseTo(0.225);
    expect(entry(result, "effect:4.4:0645")).toMatchObject({ value: 0.4 });
    expect(entry(result, "effect:4.4:0646")).toMatchObject({ value: 0.24, stacks: 3 });
    expect([...result.active, ...result.conditional].filter(({ sourceRevisionId }) => sourceRevisionId.startsWith("ability:11306"))).toHaveLength(0);

    const selfTarget = evaluateTeam(build("character:1306", 0), {
      firedThisEvaluation: { events: ["skill:ability:130602"] },
      targetAssignments: { "effect:4.4:0632": "slot-1" },
    }, bundle);
    expect(entry(selfTarget, "effect:4.4:0632")).toBeUndefined();
    expect(selfTarget.inactive).toContainEqual(expect.objectContaining({
      effectId: "effect:4.4:0632", reason: "target_not_selected",
    }));
  });

  it("shows Tribbie resistance penetration, vulnerability, and E4 defense ignore", () => {
    const result = evaluate("character:1403", 4, {
      battleStarted: true,
      activeEvents: ["skill:ability:140302", "ultimate:ability:140303"],
      firedThisEvaluation: { events: ["skill:ability:140302", "ultimate:ability:140303"] },
    }, { "ability:140302": 15, "ability:140303": 15 });
    expect(entry(result, "effect:4.4:140302-resistance-penetration")).toMatchObject({ value: 0.3 });
    expect(entry(result, "effect:4.4:140303-vulnerability")).toMatchObject({ value: 0.375, targets: ["enemy"] });
    expect(entry(result, "effect:4.4:0724")).toMatchObject({ value: 0.18 });
  });

  it("shows Cyrene team damage and the selected non-Chrysos-Heir buff", () => {
    const result = evaluate("character:1415", 0, {
      battleStarted: true,
      activeEvents: ["memosprite-skill:ability:1141502"],
      firedThisEvaluation: { events: ["memosprite-skill:ability:1141502"] },
      targetAssignments: { "effect:4.4:0812": "slot-2" },
      conditions: { speed: 180, "target-is-non-chrysos-heir": true },
    }, { "ability:141504": 15, "ability:1141502": 10 });
    expect(entry(result, "effect:4.4:141504-team-damage")).toMatchObject({ value: 0.25 });
    expect(entry(result, "effect:4.4:0812")).toMatchObject({ value: 0.56, targets: ["slot-2"] });
    expect(entry(result, "effect:4.4:0828")).toMatchObject({ value: 0.2 });
  });

  it("requires Cyrene E6 first memosprite-skill use before defense reduction", () => {
    const team = build("character:1415", 6);
    const before = evaluateTeam(team, {
      conditions: { "demiurge-present": true, "cyrene-memosprite-skill-count": 0 },
    }, bundle);
    expect(entry(before, "effect:4.4:0830")).toBeUndefined();

    const after = evaluateTeam(team, {
      conditions: { "demiurge-present": true, "cyrene-memosprite-skill-count": 1 },
    }, bundle);
    expect(entry(after, "effect:4.4:0830")).toMatchObject({ value: 0.2, targets: ["enemy"] });
  });

  it("shows Dan Heng Permansor Terrae self advance and E1 buddy penetration", () => {
    const result = evaluate("character:1414", 1, {
      battleStarted: true,
      activeEvents: ["buddy-attack", "ultimate:ability:141403"],
      firedThisEvaluation: { battleStart: true, events: ["buddy-attack", "ultimate:ability:141403"] },
      targetAssignments: { "effect:4.4:0807": "slot-2" },
    });
    expect(entry(result, "effect:4.4:0803")).toMatchObject({ value: 0.4, targets: ["slot-1"] });
    expect(entry(result, "effect:4.4:0804")).toMatchObject({ value: 6, targets: ["slot-1"] });
    expect(entry(result, "effect:4.4:0806")).toMatchObject({ value: 1 });
    expect(entry(result, "effect:4.4:0807")).toMatchObject({ value: 0.18, targets: ["slot-2"] });
  });
});
