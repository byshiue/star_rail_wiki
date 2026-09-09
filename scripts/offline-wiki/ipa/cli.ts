import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractStoryArchive, type StoryTables } from "./extractors";
import { inspectIpa, readIpaEntry } from "./ipa-reader";
import type { MissionSourceFile } from "./mission";
import { loadPinnedMapping, mergeVerifiedTextMaps, type PinnedMappingConfig } from "./source";
import { decodeTextMap } from "./text-map";
import { writeArchiveTransaction, type IpaArchiveAudit } from "./write";

type CliOptions = {
  ipaPath: string;
  mappingRoot: string;
  releaseId: string;
};

function option(arguments_: string[], name: string): string {
  const index = arguments_.indexOf(name);
  const value = index < 0 ? undefined : arguments_[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`missing required ${name}`);
  return value;
}

export function parseCliOptions(arguments_: string[]): CliOptions {
  return {
    ipaPath: resolve(option(arguments_, "--ipa")),
    mappingRoot: resolve(option(arguments_, "--mapping-root")),
    releaseId: option(arguments_, "--release"),
  };
}

function loadMissionDirectory(root: string, relativePath: string, output: MissionSourceFile[]): void {
  const directory = join(root, relativePath);
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const relative = join(relativePath, entry.name);
    const path = join(root, relative);
    if (entry.isSymbolicLink()) throw new Error(`mission source may not contain symlinks: ${relative}`);
    if (entry.isDirectory()) {
      loadMissionDirectory(root, relative, output);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    if (!lstatSync(path).isFile() || realpathSync(path) !== path) throw new Error(`mission source is not canonical: ${relative}`);
    let data: unknown;
    try {
      data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path)));
    } catch {
      throw new Error(`mission source is not valid UTF-8 JSON: ${relative}`);
    }
    output.push({ path: relative.replaceAll("\\", "/"), data });
  }
}

export function loadMissionFiles(mappingRoot: string): MissionSourceFile[] {
  const output: MissionSourceFile[] = [];
  loadMissionDirectory(mappingRoot, "Story/Mission", output);
  loadMissionDirectory(mappingRoot, "Story/Discussion/Mission", output);
  return output.sort((left, right) => left.path.localeCompare(right.path));
}

function tablesFromSnapshot(
  source: ReadonlyMap<string, Record<string, unknown>[]>,
  missionFiles: MissionSourceFile[],
): StoryTables {
  const tables: Record<string, unknown> = {};
  for (const [path, rows] of source) tables[basename(path, ".json")] = rows;
  tables.MissionFiles = missionFiles;
  const required = [
    "AvatarConfig", "AvatarSkillConfig", "StoryAtlasTextmap", "StoryAtlas",
    "EquipmentConfig", "EquipmentSkillConfig", "ItemConfigEquipment",
    "RelicSetConfig", "RelicSetSkillConfig", "RelicConfig", "ItemConfigRelic",
    "NounAtlas", "BookSeriesConfig",
    "LocalbookConfig", "RogueTournMiracleDisplay", "TalkSentenceConfig",
  ];
  for (const table of required) if (!Array.isArray(tables[table])) throw new Error(`story table ${table} is unavailable`);
  return tables as StoryTables;
}

function countFamilies(archive: ReturnType<typeof extractStoryArchive>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const record of archive.records) counts[record.family] = (counts[record.family] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

export function runIpaLoreImport(options: CliOptions): ReturnType<typeof writeArchiveTransaction> {
  const repositoryRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
  const configPath = join(repositoryRoot, "data", "offline-wiki", "ipa-sources", `${options.releaseId}.json`);
  const config = JSON.parse(readFileSync(configPath, "utf8")) as PinnedMappingConfig;
  const ipaInfo = inspectIpa(options.ipaPath);
  const ipaTextMap = decodeTextMap(readIpaEntry(options.ipaPath, ipaInfo.chineseTextMapEntry));
  const snapshot = loadPinnedMapping(options.mappingRoot, config);
  const verifiedTextMap = mergeVerifiedTextMaps(ipaTextMap, snapshot.textMap, { conflictPolicy: "prefer-supplement" });
  const missionFiles = loadMissionFiles(snapshot.root);
  const archive = extractStoryArchive(tablesFromSnapshot(snapshot.tables, missionFiles), verifiedTextMap.entries);
  const audit: IpaArchiveAudit = {
    schemaVersion: 1,
    releaseId: options.releaseId,
    summaryFallbackCount: 0,
    recordsByFamily: countFamilies(archive),
    rejectionCount: archive.rejections.length,
    textMapConflicts: verifiedTextMap.conflicts,
    source: {
      gameVersion: ipaInfo.gameVersion,
      liveVersion: ipaInfo.liveVersion,
      ipaBuildTimestamp: ipaInfo.buildTimestamp,
      ipaChecksum: ipaInfo.ipaChecksum,
      mappingRevision: snapshot.revision,
      mappingFileChecksums: Object.fromEntries(snapshot.fileChecksums),
    },
    textMap: {
      ipaEntries: ipaTextMap.primaryCount,
      mergedEntries: verifiedTextMap.entries.size,
      overlapCount: verifiedTextMap.overlapCount,
      ipaOnlyCount: verifiedTextMap.ipaOnlyCount,
      supplementOnlyCount: verifiedTextMap.supplementOnlyCount,
    },
    missionSourceFiles: missionFiles.length,
    rejections: archive.rejections,
  };
  return writeArchiveTransaction({ repositoryRoot, releaseId: options.releaseId, archive, audit });
}

function main(): void {
  const result = runIpaLoreImport(parseCliOptions(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
