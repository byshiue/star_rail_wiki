import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import effects from "../../public/data/releases/4.4-cn-2026-08-21/effects.json";
import snapshotJson from "../../data/releases/4.4-cn-2026-08-21/reviewed-skill-scaling.json";
import {
  ReviewedSkillScalingSnapshotSchema, assertReviewedSkillScalingEffects,
  deriveReviewedSkillScaling,
} from "./reviewedSkillScaling";

describe("immutable reviewed skill scaling", () => {
  const snapshot = ReviewedSkillScalingSnapshotSchema.parse(snapshotJson);

  it("binds exact 4.4 source identity and every supported level", async () => {
    const manifest = JSON.parse(await readFile("data/releases/4.4-cn-2026-08-21/source-manifest.json", "utf8"));
    expect(snapshot).toMatchObject({
      releaseId: "4.4-cn-2026-08-21",
      sourceRevision: "b95e75c7e1273d819d20c530c0b7e13a3ef19fb4",
      sourcePath: "index_new/cn/character_skills.json",
      sourceChecksum: manifest.sources[0].fileChecksums["index_new/cn/character_skills.json"],
    });
    expect(snapshot.records.map(({ featureLogicalId, maxLevel, params }) => (
      [featureLogicalId, maxLevel, params.length]
    ))).toEqual([
      ["ability:110102", 15, 15],
      ["ability:110603", 15, 15],
      ["ability:101502", 15, 15],
      ["ability:150803", 15, 15],
      ["ability:150804", 15, 15],
    ]);
  });

  it("derives exact Bronya and Pela level sequences from locked parameter columns", () => {
    expect(deriveReviewedSkillScaling(snapshot, "ability:110102")).toEqual({
      base: 0.33,
      scaling: [0.363, 0.396, 0.429, 0.462, 0.495, 0.5363, 0.5775, 0.6188, 0.66, 0.693, 0.726, 0.759, 0.792, 0.825],
    });
    expect(deriveReviewedSkillScaling(snapshot, "ability:110603")).toEqual({
      base: 0.3,
      scaling: [0.31, 0.32, 0.33, 0.34, 0.35, 0.3625, 0.375, 0.3875, 0.4, 0.41, 0.42, 0.43, 0.44, 0.45],
    });
  });

  it("derives exact Archer and Rin level sequences by audited effect ID", () => {
    expect(deriveReviewedSkillScaling(snapshot, "ability:101502", "effect:4.4:0405")).toEqual({
      base: 0.6,
      scaling: [0.64, 0.68, 0.72, 0.76, 0.8, 0.85, 0.9, 0.95, 1, 1.04, 1.08, 1.12, 1.16, 1.2],
    });
    expect(deriveReviewedSkillScaling(snapshot, "ability:150803", "effect:4.4:0865")).toEqual({
      base: 0.1,
      scaling: [0.11, 0.12, 0.13, 0.14, 0.15, 0.1625, 0.175, 0.1875, 0.2, 0.21, 0.22, 0.23, 0.24, 0.25],
    });
    expect(deriveReviewedSkillScaling(snapshot, "ability:150804", "effect:4.4:0866")).toEqual({
      base: 0.35,
      scaling: [0.385, 0.42, 0.455, 0.49, 0.525, 0.5687, 0.6125, 0.6562, 0.7, 0.735, 0.77, 0.805, 0.84, 0.875],
    });
  });

  it("accepts published values and fails closed on parameter or effect drift", () => {
    expect(() => assertReviewedSkillScalingEffects(snapshot, effects)).not.toThrow();
    const changedSnapshot = structuredClone(snapshot);
    changedSnapshot.records[0]!.params[14]![0] = 0.824;
    expect(() => assertReviewedSkillScalingEffects(changedSnapshot, effects)).toThrow(/scaling drift/i);
    const changedEffects = structuredClone(effects);
    changedEffects.find(({ id }) => id === "effect:4.4:0437")!.value.scaling[13] = 0.44;
    expect(() => assertReviewedSkillScalingEffects(snapshot, changedEffects)).toThrow(/scaling drift/i);
  });

  it("rejects a coordinated syntactically valid source checksum replacement", () => {
    const coordinated: unknown = {
      ...structuredClone(snapshot),
      sourceChecksum: `sha256:${"0".repeat(64)}`,
    };
    expect(() => ReviewedSkillScalingSnapshotSchema.parse(coordinated))
      .toThrow(/source checksum/i);
  });
});
