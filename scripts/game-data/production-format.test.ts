import { describe, expect, it } from "vitest";
import { importStarRailRes } from "./importStarRailRes";
import type { FetchedSource } from "./fetchSource";

const source = {
  name: "StarRailRes 4.4",
  baseUrl: "https://raw.githubusercontent.com/Mar-7th/StarRailRes",
  revision: "b95e75c7e1273d819d20c530c0b7e13a3ef19fb4",
  gameVersion: "4.4",
  channel: "released" as const,
  retrievedAt: "2026-08-21T12:00:00.000Z",
  fileChecksums: {},
};

function fetched(path: string, value: unknown) {
  return { path, value, checksum: `sha256:${"a".repeat(64)}`, source };
}

function realShapeSource(): FetchedSource {
  const files = new Map([
    ["index_new/cn/characters.json", fetched("index_new/cn/characters.json", {
      "1001": { id: "1001", name: "三月七", rarity: 4, path: "Knight", element: "Ice", ranks: ["100101"], skills: ["100101"], skill_trees: ["1001101"] },
    })],
    ["index_new/cn/character_ranks.json", fetched("index_new/cn/character_ranks.json", {
      "100101": { id: "100101", name: "记忆中的你", rank: 1, desc: "恢复6点能量。" },
    })],
    ["index_new/cn/character_skills.json", fetched("index_new/cn/character_skills.json", {
      "100101": { id: "100101", name: "极寒的弓矢", type_text: "普攻", desc: "造成#1[i]%攻击力的伤害。", params: [[0.5], [1.0]] },
    })],
    ["index_new/cn/character_skill_trees.json", fetched("index_new/cn/character_skill_trees.json", {
      "1001101": { id: "1001101", name: "纯洁", desc: "速度提高#1[i]%。", params: [[0.2]], levels: [] },
    })],
    ["index_new/cn/light_cones.json", fetched("index_new/cn/light_cones.json", {
      "20000": { id: "20000", name: "锋镝", rarity: 3, path: "Rogue", desc: "" },
    })],
    ["index_new/cn/light_cone_ranks.json", fetched("index_new/cn/light_cone_ranks.json", {
      "20000": {
        id: "20000", skill: "危机",
        desc: "暴击率提高#1[i]%，并恢复#2[f1]点能量。",
        params: [[0.12, 2], [0.24, 4.5]],
      },
    })],
    ["index_new/cn/relic_sets.json", fetched("index_new/cn/relic_sets.json", {
      "101": { id: "101", name: "云无留迹的过客", desc: ["治疗量提高10%。", "恢复1个战技点。"], properties: [[], []] },
    })],
  ]);
  return {
    manifest: {
      releaseId: "4.4-cn-2026-08-21",
      gameVersion: "4.4",
      channel: "released",
      importedAt: "2026-08-21T12:00:00.000Z",
      reviewedAt: "2026-08-21T12:00:00.000Z",
      previousReleaseId: null,
      sources: [source],
    },
    files,
    sourceRoot: "/tmp",
  };
}

describe("StarRailRes production object indexes", () => {
  it("joins child IDs from characters and resolves indexed parameter text", () => {
    const bundle = importStarRailRes(realShapeSource());
    expect(bundle.entities.characters).toHaveLength(1);
    expect(bundle.entities.characters[0]?.provenance[0]?.sourceUrl).toContain("b95e75c7e1273d819d20c530c0b7e13a3ef19fb4/index_new/cn/characters.json");
    expect(bundle.entities.characters[0]?.abilities[0]?.originalText).toBe("造成50%→100%攻击力的伤害。");
    expect(bundle.entities.characters[0]?.traces[0]?.originalText).toBe("速度提高20%。");
    expect(bundle.entities.characters[0]?.eidolons[0]?.originalText).toBe("恢复6点能量。");
  });

  it("combines light-cone rank text and every relic threshold", () => {
    const bundle = importStarRailRes(realShapeSource());
    expect(bundle.entities.equipment.find((item) => item.logicalId === "light-cone:20000")?.description)
      .toBe("危机：暴击率提高12%→24%，并恢复2.0→4.5点能量。");
    expect(bundle.entities.equipment.find((item) => item.logicalId === "relic-set:101")?.setThresholds)
      .toEqual([2, 4]);
  });

  it("rejects a one-based parameter token whose exact column is missing", () => {
    const input = realShapeSource();
    const skillFile = input.files.get("index_new/cn/character_skills.json")!;
    skillFile.value = {
      "100101": {
        id: "100101", name: "极寒的弓矢", type_text: "普攻",
        desc: "造成#2[i]%攻击力的伤害。", params: [[0.5], [1.0]],
      },
    };

    expect(() => importStarRailRes(input)).toThrow(/character_skills\.json.*100101.*#2\[i\].*parameter/i);
  });

  it("uses only the audited sparse-column mapping for the two real 4.4 memosprite records", () => {
    const input = realShapeSource();
    const characters = input.files.get("index_new/cn/characters.json")!;
    characters.value = {
      "1001": {
        id: "1001", name: "三月七", rarity: 4, path: "Knight", element: "Ice",
        ranks: ["100101"], skills: ["1140710"], skill_trees: ["1001101"],
      },
    };
    const skills = input.files.get("index_new/cn/character_skills.json")!;
    skills.value = {
      "1140710": {
        id: "1140710", name: "燎尽黯泽的焰息", type_text: "忆灵技",
        desc: "生命值小于等于#5[i]%时触发。", params: [[0.25], [0.25]],
      },
    };

    expect(importStarRailRes(input).entities.characters[0]?.abilities[0]?.originalText)
      .toBe("生命值小于等于25%时触发。");
  });
});
