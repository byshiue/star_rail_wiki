import type { StoryArchive, StoryFamily, StoryRecord, StoryRejection, StorySection } from "./story-schema";
import { extractMissionStories, type MissionSourceFile } from "./mission";
import { formatGameText } from "./game-text";
import { xxhash64TextKey } from "./text-key";

type JsonRow = Record<string, unknown>;
type HashRef = { Hash?: unknown };

export type StoryTables = {
  AvatarConfig: JsonRow[];
  StoryAtlasTextmap: JsonRow[];
  StoryAtlas: JsonRow[];
  EquipmentConfig: JsonRow[];
  ItemConfigEquipment: JsonRow[];
  RelicSetConfig: JsonRow[];
  RelicConfig: JsonRow[];
  ItemConfigRelic: JsonRow[];
  NounAtlas: JsonRow[];
  BookSeriesConfig: JsonRow[];
  LocalbookConfig: JsonRow[];
  RogueTournMiracleDisplay: JsonRow[];
  TalkSentenceConfig?: JsonRow[];
  MissionFiles?: MissionSourceFile[];
  [table: string]: unknown;
};

type Collector = {
  records: StoryRecord[];
  rejections: StoryRejection[];
};

const familyOrder = new Map<StoryFamily, number>([
  ["character", 0], ["light-cone", 1], ["relic-set", 2], ["worldview", 3],
  ["collectible", 4], ["divergent-universe", 5], ["mission", 6],
]);

function scalar(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  return undefined;
}

function hash(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return scalar((value as HashRef).Hash);
}

function text(textMap: ReadonlyMap<string, string>, value: unknown): { hash?: string; text?: string } {
  const key = hash(value);
  return key === undefined ? {} : { hash: key, text: textMap.get(key) };
}

function reject(
  collector: Collector,
  family: StoryFamily,
  logicalId: string,
  sourceTable: string,
  hashes: Array<string | undefined>,
): void {
  collector.rejections.push({
    family,
    logicalId,
    reason: "missing-text",
    sourceTable,
    missingHashes: [...new Set(hashes.filter((value): value is string => value !== undefined))].sort(),
  });
}

function section(order: number, title: string | null, body: string, sourceHash: string): StorySection {
  return { order, title, speaker: null, branch: null, body, sourceHash };
}

function record(
  logicalId: string,
  family: StoryFamily,
  kind: string,
  name: string,
  sections: StorySection[],
  sourceTables: string[],
  sourceRowIds: string[],
): StoryRecord {
  return { schemaVersion: 1, logicalId, family, kind, name, sections, provenance: { sourceTables, sourceRowIds } };
}

function byId(rows: JsonRow[], field: string): Map<string, JsonRow> {
  const result = new Map<string, JsonRow>();
  for (const row of rows) {
    const id = scalar(row[field]);
    if (id !== undefined) result.set(id, row);
  }
  return result;
}

function extractCharacters(tables: StoryTables, textMap: ReadonlyMap<string, string>, collector: Collector): void {
  const titles = byId(tables.StoryAtlasTextmap, "StoryID");
  const skillRows = rowsFor(tables, "AvatarSkillConfig");
  const stories = new Map<string, JsonRow[]>();
  for (const row of tables.StoryAtlas) {
    const avatarId = scalar(row.AvatarID);
    if (avatarId !== undefined) stories.set(avatarId, [...(stories.get(avatarId) ?? []), row]);
  }
  for (const avatar of tables.AvatarConfig) {
    const avatarId = scalar(avatar.AvatarID);
    if (!avatarId || avatar.Release === false || !stories.has(avatarId)) continue;
    const logicalId = `character:${avatarId}`;
    const nameValue = text(textMap, avatar.AvatarName);
    const rows = [...stories.get(avatarId)!].sort((left, right) =>
      Number(left.SortID ?? left.StoryID ?? 0) - Number(right.SortID ?? right.StoryID ?? 0));
    const sections: StorySection[] = [];
    const missing: Array<string | undefined> = [];
    let storySectionCount = 0;
    const introValue = text(textMap, avatar.AvatarCutinIntroText);
    if (introValue.text && introValue.hash) sections.push(section(sections.length, "角色介绍", introValue.text, introValue.hash));
    if (Array.isArray(avatar.SkillList)) {
      for (const skillIdValue of avatar.SkillList) {
        const skillId = scalar(skillIdValue);
        if (!skillId) continue;
        const candidates = skillRows.filter((row) => scalar(row.SkillID) === skillId)
          .sort((left, right) => Number(right.Level ?? 0) - Number(left.Level ?? 0));
        const skill = candidates[0];
        if (!skill) continue;
        const skillName = text(textMap, skill.SkillName);
        const skillDescription = text(textMap, skill.SkillDesc);
        if (skillDescription.hash && !skillDescription.text) missing.push(skillDescription.hash);
        if (skillDescription.text && skillDescription.hash) {
          sections.push(section(
            sections.length,
            `技能：${skillName.text ?? skillId}（最高等级）`,
            formatGameText(skillDescription.text, skill.ParamList),
            skillDescription.hash,
          ));
        }
      }
    }
    for (const row of rows) {
      const storyId = scalar(row.StoryID);
      const titleValue = text(textMap, storyId ? titles.get(storyId)?.StoryName : undefined);
      const bodyValue = text(textMap, row.Story);
      if (!bodyValue.text) missing.push(bodyValue.hash);
      if (bodyValue.text && bodyValue.hash) {
        sections.push(section(sections.length, titleValue.text ?? null, bodyValue.text, bodyValue.hash));
        storySectionCount += 1;
      }
    }
    if (!nameValue.text || missing.length > 0 || storySectionCount !== rows.length) {
      reject(collector, "character", logicalId, missing.length > 0 ? "StoryAtlas" : "AvatarConfig", [!nameValue.text ? nameValue.hash : undefined, ...missing]);
      continue;
    }
    collector.records.push(record(logicalId, "character", "character-story", nameValue.text, sections,
      ["AvatarConfig", "AvatarSkillConfig", "StoryAtlasTextmap", "StoryAtlas"], rows.map((row) => String(row.StoryID))));
  }
}

function extractLightCones(tables: StoryTables, textMap: ReadonlyMap<string, string>, collector: Collector): void {
  const items = byId(tables.ItemConfigEquipment, "ID");
  const skillRows = rowsFor(tables, "EquipmentSkillConfig");
  for (const equipment of tables.EquipmentConfig) {
    const id = scalar(equipment.EquipmentID);
    if (!id || equipment.Release === false) continue;
    const item = items.get(id);
    if (!item) continue;
    const logicalId = `light-cone:${id}`;
    const nameValue = text(textMap, equipment.EquipmentName);
    const bodyValue = text(textMap, item.ItemBGDesc);
    const sections: StorySection[] = [];
    const missing: Array<string | undefined> = [];
    const skillId = scalar(equipment.SkillID);
    if (skillId) {
      const levels = skillRows.filter((row) => scalar(row.SkillID) === skillId)
        .sort((left, right) => Number(left.Level ?? 0) - Number(right.Level ?? 0));
      for (const skill of levels) {
        const name = text(textMap, skill.SkillName);
        const description = text(textMap, skill.SkillDesc);
        if (!description.text) missing.push(description.hash);
        if (description.text && description.hash) sections.push(section(sections.length,
          `${name.text ?? skillId}（叠影${scalar(skill.Level) ?? "?"}）`,
          formatGameText(description.text, skill.ParamList), description.hash));
      }
    }
    if (!nameValue.text || !bodyValue.text || !bodyValue.hash || missing.length > 0) {
      reject(collector, "light-cone", logicalId, missing.length > 0 ? "EquipmentSkillConfig" : !bodyValue.text ? "ItemConfigEquipment" : "EquipmentConfig", [!nameValue.text ? nameValue.hash : undefined, !bodyValue.text ? bodyValue.hash : undefined, ...missing]);
      continue;
    }
    sections.push(section(sections.length, "光锥故事", bodyValue.text, bodyValue.hash));
    collector.records.push(record(logicalId, "light-cone", "light-cone-story", nameValue.text, sections,
      ["EquipmentConfig", "EquipmentSkillConfig", "ItemConfigEquipment"], [id]));
  }
}

const relicTypeOrder = new Map([["HEAD", 0], ["HAND", 1], ["BODY", 2], ["FOOT", 3], ["NECK", 4], ["OBJECT", 5]]);

function extractRelics(tables: StoryTables, textMap: ReadonlyMap<string, string>, collector: Collector): void {
  const itemRows = byId(tables.ItemConfigRelic, "ID");
  const skillRows = rowsFor(tables, "RelicSetSkillConfig");
  const configs = new Map<string, JsonRow[]>();
  for (const row of tables.RelicConfig) {
    const setId = scalar(row.SetID);
    if (setId !== undefined) configs.set(setId, [...(configs.get(setId) ?? []), row]);
  }
  for (const set of tables.RelicSetConfig) {
    const setId = scalar(set.SetID);
    if (!setId || set.Release === false || !configs.has(setId)) continue;
    const logicalId = `relic-set:${setId}`;
    const nameValue = text(textMap, set.SetName);
    const selected = new Map<string, JsonRow>();
    for (const config of configs.get(setId)!) {
      const type = scalar(config.Type);
      if (!type) continue;
      const current = selected.get(type);
      if (!current || String(config.Rarity ?? "") > String(current.Rarity ?? "")) selected.set(type, config);
    }
    const rows = [...selected.values()].sort((left, right) =>
      (relicTypeOrder.get(String(left.Type)) ?? 99) - (relicTypeOrder.get(String(right.Type)) ?? 99));
    const sections: StorySection[] = [];
    const missing: Array<string | undefined> = [];
    let storySectionCount = 0;
    for (const skill of skillRows.filter((row) => scalar(row.SetID) === setId)
      .sort((left, right) => Number(left.RequireNum ?? 0) - Number(right.RequireNum ?? 0))) {
      const key = scalar(skill.SkillDesc);
      if (!key) continue;
      const descriptionHash = xxhash64TextKey(key);
      const description = textMap.get(descriptionHash);
      if (!description) missing.push(descriptionHash);
      if (description) sections.push(section(
        sections.length,
        `${scalar(skill.RequireNum) ?? "?"}件套效果`,
        formatGameText(description, skill.AbilityParamList),
        descriptionHash,
      ));
    }
    for (const config of rows) {
      const item = itemRows.get(String(config.ID));
      const titleValue = text(textMap, item?.ItemName);
      const bodyValue = text(textMap, item?.ItemBGDesc);
      if (!titleValue.text) missing.push(titleValue.hash);
      if (!bodyValue.text) missing.push(bodyValue.hash);
      if (titleValue.text && bodyValue.text && bodyValue.hash) {
        sections.push(section(sections.length, titleValue.text, bodyValue.text, bodyValue.hash));
        storySectionCount += 1;
      }
    }
    if (!nameValue.text || missing.length > 0 || storySectionCount !== rows.length) {
      reject(collector, "relic-set", logicalId, "ItemConfigRelic", [!nameValue.text ? nameValue.hash : undefined, ...missing]);
      continue;
    }
    collector.records.push(record(logicalId, "relic-set", "relic-set-story", nameValue.text, sections,
      ["RelicSetConfig", "RelicSetSkillConfig", "RelicConfig", "ItemConfigRelic"], rows.map((row) => String(row.ID))));
  }
}

function extractWorldview(tables: StoryTables, textMap: ReadonlyMap<string, string>, collector: Collector): void {
  for (const row of tables.NounAtlas) {
    const id = scalar(row.ID) ?? scalar(row.SortID);
    if (!id) continue;
    const logicalId = `worldview:${id}`;
    const nameValue = text(textMap, row.NounTitle);
    const bodyValue = text(textMap, row.NounDesc);
    if (!nameValue.text || !bodyValue.text || !bodyValue.hash) {
      reject(collector, "worldview", logicalId, "NounAtlas", [!nameValue.text ? nameValue.hash : undefined, !bodyValue.text ? bodyValue.hash : undefined]);
      continue;
    }
    collector.records.push(record(logicalId, "worldview", "noun-atlas", nameValue.text,
      [section(0, null, bodyValue.text, bodyValue.hash)], ["NounAtlas"], [id]));
  }
}

function extractCollectibles(tables: StoryTables, textMap: ReadonlyMap<string, string>, collector: Collector): void {
  const books = new Map<string, JsonRow[]>();
  for (const row of tables.LocalbookConfig) {
    const seriesId = scalar(row.BookSeriesID);
    if (seriesId) books.set(seriesId, [...(books.get(seriesId) ?? []), row]);
  }
  for (const series of tables.BookSeriesConfig) {
    const seriesId = scalar(series.BookSeriesID);
    if (!seriesId || !books.has(seriesId)) continue;
    const logicalId = `collectible:${seriesId}`;
    const nameValue = text(textMap, series.BookSeries);
    const rows = [...books.get(seriesId)!].sort((left, right) => Number(left.BookSeriesInsideID ?? 0) - Number(right.BookSeriesInsideID ?? 0));
    const sections: StorySection[] = [];
    const missing: Array<string | undefined> = [];
    const comments = text(textMap, series.BookSeriesComments);
    if (comments.hash && !comments.text) missing.push(comments.hash);
    if (comments.text && comments.hash) sections.push(section(sections.length, "系列简介", comments.text, comments.hash));
    for (const row of rows) {
      const titleValue = text(textMap, row.BookInsideName);
      const bodyValue = text(textMap, row.BookContent);
      if (!titleValue.text) missing.push(titleValue.hash);
      if (!bodyValue.text) missing.push(bodyValue.hash);
      if (titleValue.text && bodyValue.text && bodyValue.hash) sections.push(section(sections.length, titleValue.text, bodyValue.text, bodyValue.hash));
    }
    if (!nameValue.text || missing.length > 0 || sections.length < rows.length) {
      reject(collector, "collectible", logicalId, "LocalbookConfig", [!nameValue.text ? nameValue.hash : undefined, ...missing]);
      continue;
    }
    collector.records.push(record(logicalId, "collectible", "book-series", nameValue.text, sections,
      ["BookSeriesConfig", "LocalbookConfig"], rows.map((row) => String(row.BookID))));
  }
}

type DivergentAdapter = {
  table: string;
  kind: string;
  id: string;
  name?: string;
  label: string;
  sections: readonly [field: string, title: string | null][];
};

const divergentAdapters: readonly DivergentAdapter[] = [
  { table: "RogueTournMiracleDisplay", kind: "miracle", id: "MiracleDisplayID", name: "MiracleName", label: "奇物", sections: [["MiracleBGDesc", "故事"]] },
  { table: "RogueTournFormulaDisplay", kind: "formula", id: "FormulaDisplayID", label: "方程", sections: [["FormulaStory", "故事"]] },
  { table: "RogueTournHexDisplay", kind: "hex", id: "HexDisplayID", name: "Name", label: "加权奇物", sections: [["BgDesc", "故事"]] },
  { table: "RogueTournCollection", kind: "collection", id: "CollectionID", name: "CollectionName", label: "收藏", sections: [["CollectionDesc", "说明"], ["CollectionEffectDesc", "效果"]] },
  { table: "RogueTournDivision", kind: "division", id: "DivisionID", name: "DivisionName", label: "位面", sections: [["DivisionHintDesc", "说明"]] },
  { table: "RogueTournDivisionEffect", kind: "division-effect", id: "DivisionEffectID", label: "位面效果", sections: [["DescText", "效果"]] },
  { table: "RogueTournPermanentTalent", kind: "permanent-talent", id: "TalentID", name: "EffectTitle", label: "常驻天赋", sections: [["EffectTag", "标签"], ["EffectDesc", "效果"]] },
  { table: "RogueTournTitanTalent", kind: "titan-talent", id: "ID", name: "TalentTitle", label: "泰坦天赋", sections: [["TalentDesc", "效果"], ["ActTitle", "行动"]] },
  { table: "RogueTournWorkbenchFunc", kind: "workbench", id: "FuncID", name: "FuncName", label: "造物台", sections: [["FuncDesc", "说明"], ["DisableFuncDesc", "未解锁说明"]] },
  { table: "RogueTournContentDisplay", kind: "content", id: "DisplayID", label: "图鉴文字", sections: [["DisplayContent", null]] },
  { table: "RogueTournMiscDisplay", kind: "misc", id: "DisplayID", label: "其他文字", sections: [["DisplayContent", null]] },
  { table: "RogueTournWeeklyDisplay", kind: "weekly", id: "WeeklyDisplayID", label: "周期文字", sections: [["WeeklyDisplayContent", null]] },
  { table: "RogueTournUnlock", kind: "unlock", id: "RogueUnlockID", label: "解锁说明", sections: [["RogueUnlockDetail", null]] },
];

function rowsFor(tables: StoryTables, table: string): JsonRow[] {
  const value = tables[table];
  return Array.isArray(value) ? value.filter((row): row is JsonRow => !!row && typeof row === "object" && !Array.isArray(row)) : [];
}

function extractDivergentUniverse(tables: StoryTables, textMap: ReadonlyMap<string, string>, collector: Collector): void {
  for (const adapter of divergentAdapters) {
    for (const row of rowsFor(tables, adapter.table)) {
      const id = scalar(row[adapter.id]);
      if (!id) continue;
      const logicalId = `divergent-universe:${adapter.kind}:${id}`;
      const nameValue = adapter.name ? text(textMap, row[adapter.name]) : {};
      const sections: StorySection[] = [];
      const missing: Array<string | undefined> = [];
      for (const [field, title] of adapter.sections) {
        const value = text(textMap, row[field]);
        if (value.hash && !value.text) missing.push(value.hash);
        if (value.text && value.hash) sections.push(section(sections.length, title, value.text, value.hash));
      }
      if (adapter.name && !nameValue.text) missing.push(nameValue.hash);
      if (missing.length > 0) {
        reject(collector, "divergent-universe", logicalId, adapter.table, missing);
        continue;
      }
      if (sections.length === 0) continue;
      collector.records.push(record(logicalId, "divergent-universe", adapter.kind,
        nameValue.text ?? `${adapter.label} ${id}`, sections, [adapter.table], [id]));
    }
  }
}


function referencedIds(tables: StoryTables, specifications: readonly [table: string, field: string][]): Set<string> {
  const result = new Set<string>();
  for (const [table, field] of specifications) {
    for (const row of rowsFor(tables, table)) {
      const value = scalar(row[field]);
      if (value && value !== "0") result.add(value);
    }
  }
  return result;
}

function extractDivergentAbilities(tables: StoryTables, textMap: ReadonlyMap<string, string>, collector: Collector): void {
  const mazeBuffIds = referencedIds(tables, [
    ["RogueTournFormula", "MazeBuffID"], ["RogueTournHex", "MazeBuffID"],
    ["RogueTournBuff", "MazeBuffID"], ["RogueTournTitanBless", "MazeBuffID"],
  ]);
  for (const row of rowsFor(tables, "MazeBuff")) {
    const id = scalar(row.ID);
    if (!id || !mazeBuffIds.has(id)) continue;
    const level = scalar(row.Lv) ?? "0";
    const logicalId = `divergent-universe:ability:maze-buff:${id}:${level}`;
    const nameValue = text(textMap, row.BuffName);
    const fields: readonly [string, string][] = [["BuffDesc", "能力"], ["BuffDescBattle", "战斗内说明"], ["BuffEffect", "效果文字"]];
    const sections: StorySection[] = [];
    const missing: Array<string | undefined> = [];
    const seen = new Set<string>();
    for (const [field, title] of fields) {
      const value = text(textMap, row[field]);
      if (value.hash && !value.text) missing.push(value.hash);
      if (value.text && value.hash && !seen.has(value.hash)) {
        seen.add(value.hash);
        sections.push(section(sections.length, title, value.text, value.hash));
      }
    }
    if (missing.length > 0) {
      reject(collector, "divergent-universe", logicalId, "MazeBuff", missing);
      continue;
    }
    if (sections.length === 0) continue;
    collector.records.push(record(logicalId, "divergent-universe", "maze-buff", nameValue.text ?? `差分宇宙能力 ${id}`, sections, ["MazeBuff"], [`${id}:${level}`]));
  }

  const miracleEffectIds = referencedIds(tables, [["RogueTournMiracle", "MiracleEffectID"]]);
  for (const row of rowsFor(tables, "RogueMiracleEffect")) {
    const id = scalar(row.MiracleEffectID);
    if (!id || !miracleEffectIds.has(id)) continue;
    const bodyValue = text(textMap, row.MiracleDesc);
    const logicalId = `divergent-universe:ability:miracle-effect:${id}`;
    if (!bodyValue.text || !bodyValue.hash) {
      reject(collector, "divergent-universe", logicalId, "RogueMiracleEffect", [bodyValue.hash]);
      continue;
    }
    collector.records.push(record(logicalId, "divergent-universe", "miracle-effect", `奇物能力 ${id}`,
      [section(0, "能力", bodyValue.text, bodyValue.hash)], ["RogueTournMiracle", "RogueMiracleEffect"], [id]));
  }
}
export function extractStoryArchive(tables: StoryTables, textMap: ReadonlyMap<string, string>): StoryArchive {
  const collector: Collector = { records: [], rejections: [] };
  extractCharacters(tables, textMap, collector);
  extractLightCones(tables, textMap, collector);
  extractRelics(tables, textMap, collector);
  extractWorldview(tables, textMap, collector);
  extractCollectibles(tables, textMap, collector);
  extractDivergentAbilities(tables, textMap, collector);
  extractDivergentUniverse(tables, textMap, collector);
  if (tables.TalkSentenceConfig && tables.MissionFiles) {
    const missions = extractMissionStories(tables.TalkSentenceConfig, tables.MissionFiles, textMap);
    collector.records.push(...missions.records);
    collector.rejections.push(...missions.rejections);
  }
  collector.records.sort((left, right) => (familyOrder.get(left.family)! - familyOrder.get(right.family)!) || left.logicalId.localeCompare(right.logicalId));
  collector.rejections.sort((left, right) => (familyOrder.get(left.family)! - familyOrder.get(right.family)!) || left.logicalId.localeCompare(right.logicalId));
  return { schemaVersion: 1, records: collector.records, rejections: collector.rejections };
}
