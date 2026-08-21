import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Effect } from "../../src/domain/effects";
import { buildRelease } from "./buildRelease";
import { diffReleases } from "./diffReleases";
import { fetchSource } from "./fetchSource";
import { importStarRailRes } from "./importStarRailRes";
import { loadSourceManifest } from "./sourceManifest";

const fixtureRoot = path.resolve("scripts/game-data/__fixtures__/source");

async function fixtureManifest() {
  return loadSourceManifest(path.join(fixtureRoot, "manifest.json"));
}

function effect(id: string, originalText: string): Effect {
  return {
    id,
    sourceRevisionId: "ability:100101@4.3-reviewed-local-fixture",
    metric: "damage_bonus",
    operation: "percent",
    value: { base: 0.2, scaling: [] },
    target: { type: "team" },
    trigger: { type: "always" },
    duration: { type: "permanent" },
    stacking: { type: "none", maxStacks: 1 },
    conditions: [],
    dispellable: null,
    reviewStatus: "generated",
    originalText,
  };
}

describe("fetchSource security boundary", () => {
  it("rejects a direct caller whose download template omits the immutable revision", async () => {
    const manifest = await fixtureManifest();
    manifest.sources[0].downloadUrlTemplate = "{baseUrl}/{path}";

    await expect(fetchSource(manifest, fixtureRoot)).rejects.toThrow(/template.*revision|immutable revision/i);
  });

  it("rejects a direct caller that requests a non-allowlisted image path", async () => {
    const manifest = await fixtureManifest();
    manifest.sources[0].fileChecksums["icon/character/1001.png"] = `sha256:${"0".repeat(64)}`;

    await expect(fetchSource(manifest, fixtureRoot)).rejects.toThrow(/not allowlisted.*icon\/character\/1001\.png/i);
  });
});

describe("effect release diffs", () => {
  it("reports effect-only additions, removals, and field changes in stable order", async () => {
    const manifest = await fixtureManifest();
    const previous = await buildRelease({ manifest, sourceRoot: fixtureRoot });
    const next = structuredClone(previous);
    previous.entities.effects = [
      effect("changed", "旧效果文本"),
      effect("removed", "被移除的效果"),
    ];
    next.entities.effects = [
      effect("added", "新增效果"),
      effect("changed", "新效果文本"),
    ];

    expect(diffReleases(previous, next)).toEqual([
      {
        logicalId: "effect:added",
        kind: "added",
        changes: [{ path: "$", before: undefined, after: expect.objectContaining({ originalText: "新增效果" }) }],
      },
      {
        logicalId: "effect:changed",
        kind: "changed",
        changes: [{ path: "originalText", before: "旧效果文本", after: "新效果文本" }],
      },
      {
        logicalId: "effect:removed",
        kind: "removed",
        changes: [{ path: "$", before: expect.objectContaining({ originalText: "被移除的效果" }), after: undefined }],
      },
    ]);
  });
});

describe("child-record completeness", () => {
  it.each([
    ["index_new/cn/character_skills.json", { id: 900001, characterId: 9999, type: "战技", name: "孤儿战技", description: "孤儿战技文本。" }, "900001"],
    ["index_new/cn/character_skill_trees.json", { id: 900002, characterId: 9999, type: "额外能力", name: "孤儿行迹", description: "孤儿行迹文本。" }, "900002"],
    ["index_new/cn/character_ranks.json", { id: 900003, characterId: 9999, rank: 2, name: "孤儿星魂", description: "孤儿星魂文本。" }, "900003"],
    ["index_new/cn/light_cone_ranks.json", { lightConeId: 9999, values: [0.1] }, "9999"],
  ])("rejects an orphan in %s and identifies its record", async (sourcePath, record, recordId) => {
    const source = await fetchSource(await fixtureManifest(), fixtureRoot);
    const sourceFile = source.files.get(sourcePath);
    if (!sourceFile || !Array.isArray(sourceFile.value)) throw new Error(`invalid test fixture ${sourcePath}`);
    sourceFile.value.push(record);

    expect(() => importStarRailRes(source)).toThrow(new RegExp(`${sourcePath}.*${recordId}`, "i"));
  });

  it("rejects ambiguous duplicate eidolon ranks for one character", async () => {
    const source = await fetchSource(await fixtureManifest(), fixtureRoot);
    const sourcePath = "index_new/cn/character_ranks.json";
    const sourceFile = source.files.get(sourcePath);
    if (!sourceFile || !Array.isArray(sourceFile.value)) throw new Error("invalid rank fixture");
    sourceFile.value.push({ id: 100107, characterId: 1001, rank: 1, name: "重复星魂", description: "重复。" });

    expect(() => importStarRailRes(source)).toThrow(/character_ranks\.json.*1001.*rank 1/i);
  });

  it("rejects ambiguous duplicate light-cone rank records", async () => {
    const source = await fetchSource(await fixtureManifest(), fixtureRoot);
    const sourcePath = "index_new/cn/light_cone_ranks.json";
    const sourceFile = source.files.get(sourcePath);
    if (!sourceFile || !Array.isArray(sourceFile.value)) throw new Error("invalid light-cone rank fixture");
    sourceFile.value.push({ lightConeId: 23024, values: [0.3] });

    expect(() => importStarRailRes(source)).toThrow(/light_cone_ranks\.json.*23024.*duplicate|duplicate.*23024/i);
  });
});
