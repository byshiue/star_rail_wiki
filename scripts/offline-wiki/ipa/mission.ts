import { basename } from "node:path";
import type { StoryArchive, StoryRecord, StorySection } from "./story-schema";

type JsonRow = Record<string, unknown>;

export type MissionSourceFile = {
  path: string;
  data: unknown;
};

function scalar(value: unknown): string | undefined {
  if (typeof value === "string" && /^\d+$/u.test(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return undefined;
}

function hash(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return scalar((value as JsonRow).Hash);
}

function collectOptionBranches(value: unknown, sourcePath: string, result: Map<string, string[]>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectOptionBranches(item, sourcePath, result);
    return;
  }
  if (!value || typeof value !== "object") return;
  const row = value as JsonRow;
  if (row.$type === "RPG.GameCore.PlayOptionTalk" && Array.isArray(row.OptionList)) {
    for (const optionValue of row.OptionList) {
      if (!optionValue || typeof optionValue !== "object" || Array.isArray(optionValue)) continue;
      const id = scalar((optionValue as JsonRow).TalkSentenceID);
      if (!id) continue;
      const branch = `${basename(sourcePath)}#option:${id}`;
      result.set(id, [...new Set([...(result.get(id) ?? []), branch])]);
    }
  }
  for (const child of Object.values(row)) collectOptionBranches(child, sourcePath, result);
}

export function extractMissionStories(
  talkRows: JsonRow[],
  missionFiles: MissionSourceFile[],
  textMap: ReadonlyMap<string, string>,
): StoryArchive {
  const branches = new Map<string, string[]>();
  for (const file of [...missionFiles].sort((left, right) => left.path.localeCompare(right.path))) {
    collectOptionBranches(file.data, file.path, branches);
  }

  const groups = new Map<string, JsonRow[]>();
  for (const row of talkRows) {
    const id = scalar(row.TalkSentenceID);
    if (!id || id.length <= 3) continue;
    const group = id.slice(0, -3);
    groups.set(group, [...(groups.get(group) ?? []), row]);
  }

  const records: StoryRecord[] = [];
  const rejections: StoryArchive["rejections"] = [];
  for (const [group, rowsValue] of [...groups].sort(([left], [right]) => left.localeCompare(right))) {
    const logicalId = `mission-dialogue:${group}`;
    const rows = [...rowsValue].sort((left, right) => BigInt(scalar(left.TalkSentenceID)!) < BigInt(scalar(right.TalkSentenceID)!) ? -1 : 1);
    const sections: StorySection[] = [];
    const missingHashes: string[] = [];
    for (const row of rows) {
      const id = scalar(row.TalkSentenceID)!;
      const bodyHash = hash(row.TalkSentenceText);
      const speakerHash = hash(row.TextmapTalkSentenceName);
      const body = bodyHash ? textMap.get(bodyHash) : undefined;
      const speaker = speakerHash ? textMap.get(speakerHash) : undefined;
      if (bodyHash && !body) missingHashes.push(bodyHash);
      if (speakerHash && !speaker) missingHashes.push(speakerHash);
      if (!body || !bodyHash || (speakerHash !== undefined && speaker === undefined)) continue;
      const rowBranches = branches.get(id) ?? [null];
      for (const branch of rowBranches) {
        sections.push({
          order: sections.length,
          title: null,
          speaker: speaker ?? null,
          branch,
          body,
          sourceHash: bodyHash,
        });
      }
    }
    if (missingHashes.length === 0 && sections.length === 0) continue;
    if (missingHashes.length > 0 || sections.length === 0) {
      rejections.push({
        family: "mission",
        logicalId,
        reason: "missing-text",
        sourceTable: "TalkSentenceConfig",
        missingHashes: [...new Set(missingHashes)].sort(),
      });
      continue;
    }
    records.push({
      schemaVersion: 1,
      logicalId,
      family: "mission",
      kind: "talk-sentence-group",
      name: `任务台词 ${group}`,
      sections,
      provenance: {
        sourceTables: ["TalkSentenceConfig", "Story/Mission", "Story/Discussion/Mission"],
        sourceRowIds: rows.map((row) => scalar(row.TalkSentenceID)!),
      },
    });
  }
  return { schemaVersion: 1, records, rejections };
}
