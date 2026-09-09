import { describe, expect, it } from "vitest";
import { extractMissionStories } from "./mission";

const textMap = new Map<string, string>([
  ["1", "银狼"], ["2", "普通台词完整正文"],
  ["3", "选项甲完整正文"], ["4", "选项乙完整正文"],
]);

const talkRows = [
  { TalkSentenceID: 100100001, TextmapTalkSentenceName: { Hash: 1 }, TalkSentenceText: { Hash: 2 } },
  { TalkSentenceID: 100100002, TalkSentenceText: { Hash: 3 } },
  { TalkSentenceID: 100100003, TalkSentenceText: { Hash: 4 } },
];

const missionFiles = [{
  path: "Story/Discussion/Mission/1001001/DS100100101.json",
  data: {
    OnStartSequece: [{ TaskList: [
      { $type: "RPG.GameCore.LevelPerformanceInitialize", Story: { Hash: 2 } },
      { $type: "RPG.GameCore.PlayOptionTalk", OptionList: [
        { TalkSentenceID: 100100002 },
        { TalkSentenceID: 100100003 },
      ] },
    ] }],
  },
}];

describe("mission dialogue extraction", () => {
  it("keeps ordinary dialogue and each explicit option as separate ordered sections", () => {
    const archive = extractMissionStories(talkRows, missionFiles, textMap);

    expect(archive.rejections).toEqual([]);
    expect(archive.records).toHaveLength(1);
    expect(archive.records[0]).toMatchObject({
      family: "mission",
      logicalId: "mission-dialogue:100100",
      name: "任务台词 100100",
      sections: [
        { order: 0, speaker: "银狼", branch: null, body: "普通台词完整正文", sourceHash: "2" },
        { order: 1, speaker: null, branch: "DS100100101.json#option:100100002", body: "选项甲完整正文", sourceHash: "3" },
        { order: 2, speaker: null, branch: "DS100100101.json#option:100100003", body: "选项乙完整正文", sourceHash: "4" },
      ],
    });
  });

  it("ignores hashes placed on control nodes instead of treating them as dialogue", () => {
    const archive = extractMissionStories(talkRows.slice(0, 1), missionFiles, textMap);
    expect(archive.records[0]?.sections).toHaveLength(1);
    expect(archive.records[0]?.sections[0]?.body).toBe("普通台词完整正文");
  });

  it("duplicates a reused option into distinct branch sections instead of merging branches", () => {
    const files = [...missionFiles, {
      path: "Story/Discussion/Mission/1001001/DS100100102.json",
      data: { OnStartSequece: [{ TaskList: [{
        $type: "RPG.GameCore.PlayOptionTalk",
        OptionList: [{ TalkSentenceID: 100100002 }],
      }] }] },
    }];
    const archive = extractMissionStories(talkRows.slice(1, 2), files, textMap);
    expect(archive.records[0]?.sections.map((value) => value.branch)).toEqual([
      "DS100100101.json#option:100100002",
      "DS100100102.json#option:100100002",
    ]);
  });

  it("rejects the complete dialogue group if a body hash is unavailable", () => {
    const archive = extractMissionStories([
      ...talkRows,
      { TalkSentenceID: 100100004, TalkSentenceText: { Hash: 999 } },
    ], missionFiles, textMap);
    expect(archive.records).toEqual([]);
    expect(archive.rejections).toEqual([{
      family: "mission",
      logicalId: "mission-dialogue:100100",
      reason: "missing-text",
      sourceTable: "TalkSentenceConfig",
      missingHashes: ["999"],
    }]);
  });
  it("skips non-text control placeholders without reporting missing official body hashes", () => {
    const result = extractMissionStories([{ TalkSentenceID: 900900101 }], [], textMap);
    expect(result).toEqual({ schemaVersion: 1, records: [], rejections: [] });
  });
});
