import { describe, expect, it } from "vitest";
import { extractStoryArchive, type StoryTables } from "./extractors";
import { xxhash64TextKey } from "./text-key";

const textMap = new Map<string, string>([
  ["1", "角色甲"], ["2", "角色故事·一"], ["3", "角色完整故事"],
  ["4", "光锥甲"], ["5", "光锥完整故事"],
  ["6", "遗器套装甲"], ["7", "头部"], ["8", "头部完整故事"], ["9", "手部"], ["10", "手部完整故事"],
  ["11", "名词甲"], ["12", "名词完整说明"],
  ["13", "书系甲"], ["14", "书系完整说明"], ["15", "第一卷"], ["16", "第一卷完整正文"],
  ["17", "奇物甲"], ["18", "奇物完整故事"], ["19", "方程完整故事"], ["20", "无标题完整故事"], ["21", "方程能力"], ["22", "方程能力完整说明"], ["23", "奇物能力完整说明"], ["24", "角色介绍完整原文"], ["25", "战技甲"], ["26", "造成#1[i]%伤害。"],
  ["27", "光锥能力甲"], ["28", "使暴击率提高#1[i]%。"],
]);
textMap.set(xxhash64TextKey("RelicDesc_fixture"), "攻击力提高#1[i]%。");

function tables(): StoryTables {
  return {
    AvatarConfig: [{ AvatarID: 1001, AvatarName: { Hash: 1 }, Release: true }],
    StoryAtlasTextmap: [{ StoryID: 1, StoryName: { Hash: 2 } }],
    StoryAtlas: [{ AvatarID: 1001, StoryID: 1, Story: { Hash: 3 }, SortID: 2 }],
    EquipmentConfig: [{ EquipmentID: 2001, EquipmentName: { Hash: 4 }, Release: true }],
    ItemConfigEquipment: [{ ID: 2001, ItemBGDesc: { Hash: 5 } }],
    RelicSetConfig: [{ SetID: 301, SetName: { Hash: 6 }, Release: true }],
    RelicConfig: [
      { ID: 61012, SetID: 301, Type: "HAND", Rarity: "CombatPowerRelicRarity5" },
      { ID: 61011, SetID: 301, Type: "HEAD", Rarity: "CombatPowerRelicRarity5" },
    ],
    ItemConfigRelic: [
      { ID: 61012, ItemName: { Hash: 9 }, ItemBGDesc: { Hash: 10 } },
      { ID: 61011, ItemName: { Hash: 7 }, ItemBGDesc: { Hash: 8 } },
    ],
    NounAtlas: [{ ID: 4001, NounTitle: { Hash: 11 }, NounDesc: { Hash: 12 }, SortID: 1 }],
    BookSeriesConfig: [{ BookSeriesID: 501, BookSeries: { Hash: 13 }, BookSeriesComments: { Hash: 14 } }],
    LocalbookConfig: [{ BookID: 5001, BookSeriesID: 501, BookSeriesInsideID: 1, BookInsideName: { Hash: 15 }, BookContent: { Hash: 16 } }],
    RogueTournMiracleDisplay: [{ MiracleDisplayID: 6001, MiracleName: { Hash: 17 }, MiracleBGDesc: { Hash: 18 } }],
    RogueTournFormulaDisplay: [{ FormulaDisplayID: 6002, FormulaStory: { Hash: 19 } }],
    RogueTournFormula: [{ FormulaDisplayID: 6002, MazeBuffID: 7001 }],
    RogueTournHex: [], RogueTournBuff: [], RogueTournTitanBless: [],
    MazeBuff: [{ ID: 7001, Lv: 1, BuffName: { Hash: 21 }, BuffDesc: { Hash: 22 } }],
    RogueTournMiracle: [{ MiracleEffectID: 8001 }],
    RogueMiracleEffect: [{ MiracleEffectID: 8001, MiracleDesc: { Hash: 23 } }],
  };
}

describe("4.5 complete story extractors", () => {
  it("extracts six explicit table families with stable IDs, order, titles and complete bodies", () => {
    const archive = extractStoryArchive(tables(), textMap);

    expect(archive.rejections).toEqual([]);
    expect(archive.records.map((record) => [record.family, record.logicalId])).toEqual([
      ["character", "character:1001"],
      ["light-cone", "light-cone:2001"],
      ["relic-set", "relic-set:301"],
      ["worldview", "worldview:4001"],
      ["collectible", "collectible:501"],
      ["divergent-universe", "divergent-universe:ability:maze-buff:7001:1"],
      ["divergent-universe", "divergent-universe:ability:miracle-effect:8001"],
      ["divergent-universe", "divergent-universe:formula:6002"],
      ["divergent-universe", "divergent-universe:miracle:6001"],
    ]);

    expect(archive.records[0]).toMatchObject({
      name: "角色甲",
      sections: [{ order: 0, title: "角色故事·一", body: "角色完整故事", sourceHash: "3" }],
    });
    expect(archive.records[2]?.sections.map((section) => [section.title, section.body])).toEqual([
      ["头部", "头部完整故事"],
      ["手部", "手部完整故事"],
    ]);
    expect(archive.records[4]?.sections.map((section) => [section.title, section.body])).toEqual([
      ["系列简介", "书系完整说明"],
      ["第一卷", "第一卷完整正文"],
    ]);
  });

  it("rejects an entire record when any required body hash is missing and never substitutes a summary", () => {
    const fixture = tables();
    fixture.StoryAtlas.push({ AvatarID: 1001, StoryID: 2, Story: { Hash: 999 }, SortID: 1 });
    fixture.StoryAtlasTextmap.push({ StoryID: 2, StoryName: { Hash: 2 } });

    const archive = extractStoryArchive(fixture, textMap);

    expect(archive.records.some((record) => record.logicalId === "character:1001")).toBe(false);
    expect(archive.rejections).toContainEqual({
      family: "character",
      logicalId: "character:1001",
      reason: "missing-text",
      sourceTable: "StoryAtlas",
      missingHashes: ["999"],
    });
    expect(JSON.stringify(archive.rejections)).not.toContain("角色完整故事");
  });

  it("does not classify unrelated long text fields by keywords", () => {
    const fixture = tables() as StoryTables & { UnknownStoryLikeTable: unknown[] };
    fixture.UnknownStoryLikeTable = [{ ID: 9, Story: { Hash: 3 } }];
    const archive = extractStoryArchive(fixture, textMap);
    expect(archive.records).toHaveLength(9);
  });
  it("keeps a complete character story when the official section title is absent", () => {
    const fixture = tables();
    fixture.StoryAtlas.push({ AvatarID: 1001, StoryID: 10, Story: { Hash: 20 }, SortID: 10 });
    const archive = extractStoryArchive(fixture, textMap);
    const character = archive.records.find((record) => record.logicalId === "character:1001");
    expect(character?.sections.at(-1)).toMatchObject({ title: null, body: "无标题完整故事" });
    expect(archive.rejections.some((value) => value.logicalId === "character:1001")).toBe(false);
  });

  it("adds character introductions and formatted character, light-cone and relic abilities", () => {
    const fixture = tables();
    fixture.AvatarConfig[0]!.SkillList = [100101];
    fixture.AvatarConfig[0]!.AvatarCutinIntroText = { Hash: 24 };
    fixture.AvatarSkillConfig = [{ SkillID: 100101, Level: 10, SkillName: { Hash: 25 }, SkillDesc: { Hash: 26 }, ParamList: [{ Value: 1.25 }] }];
    fixture.EquipmentConfig[0]!.SkillID = 2001;
    fixture.EquipmentSkillConfig = [{ SkillID: 2001, Level: 1, SkillName: { Hash: 27 }, SkillDesc: { Hash: 28 }, ParamList: [{ Value: 0.18 }] }];
    fixture.RelicSetSkillConfig = [{ SetID: 301, RequireNum: 2, SkillDesc: "RelicDesc_fixture", AbilityParamList: [{ Value: 0.12 }] }];
    const archive = extractStoryArchive(fixture, textMap);
    expect(archive.records.find((value) => value.logicalId === "character:1001")?.sections.map((value) => value.body)).toEqual([
      "角色介绍完整原文", "造成125%伤害。", "角色完整故事",
    ]);
    expect(archive.records.find((value) => value.logicalId === "light-cone:2001")?.sections.map((value) => value.body)).toEqual([
      "使暴击率提高18%。", "光锥完整故事",
    ]);
    expect(archive.records.find((value) => value.logicalId === "relic-set:301")?.sections[0]?.body).toBe("攻击力提高12%。");
  });

  it("keeps character skills and stories when optional introduction text is unavailable", () => {
    const fixture = tables();
    fixture.AvatarConfig[0]!.AvatarCutinIntroText = { Hash: 999 };
    fixture.AvatarConfig[0]!.SkillList = [100109];
    fixture.AvatarSkillConfig = [{ SkillID: 100109, Level: 1 }];
    const archive = extractStoryArchive(fixture, textMap);
    expect(archive.records.some((record) => record.logicalId === "character:1001")).toBe(true);
    expect(archive.rejections.some((value) => value.logicalId === "character:1001")).toBe(false);
  });

  it("includes the mission family when task dialogue tables are supplied", () => {
    const fixture = tables();
    fixture.TalkSentenceConfig = [{ TalkSentenceID: 700100001, TextmapTalkSentenceName: { Hash: 1 }, TalkSentenceText: { Hash: 3 } }];
    fixture.MissionFiles = [];
    const archive = extractStoryArchive(fixture, textMap);
    expect(archive.records.some((record) => record.logicalId === "mission-dialogue:700100")).toBe(true);
  });
});
