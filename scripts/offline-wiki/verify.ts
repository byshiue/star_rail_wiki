import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { countPdfPages } from "./pdf/inspect";

const ChecksumSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const SafeHtmlFilenameSchema = z.string().regex(/^[^/\\]+\.html$/);
const SafePdfFilenameSchema = z.string().regex(/^[^/\\]+\.pdf$/);
const LoreFamilySchema = z.enum(["divergent-universe", "worldview", "mission", "collectible"]);
const BuildManifestSchema = z.strictObject({
  schemaVersion: z.literal(2),
  releaseId: z.string().min(1),
  inputs: z.array(z.strictObject({ filename: SafeHtmlFilenameSchema, checksum: ChecksumSchema })),
  outputs: z.array(z.strictObject({
    filename: SafePdfFilenameSchema,
    checksum: ChecksumSchema,
    pageCount: z.number().int().positive(),
    family: LoreFamilySchema.nullable(),
    group: z.string().min(1),
    order: z.number().int().nonnegative(),
  })),
});

type Family = z.infer<typeof LoreFamilySchema>;
type VolumeMetadata = { family: Family | null; group: string; sortKey: readonly number[] };

const CORE_VOLUMES = new Map<string, VolumeMetadata>([
  ["00-总索引", { family: null, group: "global-index", sortKey: [0] }],
  ["01-角色图鉴", { family: null, group: "characters", sortKey: [1] }],
  ["02-光锥图鉴", { family: null, group: "light-cones", sortKey: [2] }],
  ["03-遗器图鉴", { family: null, group: "relic-sets", sortKey: [3] }],
]);

const LORE_TAXONOMY: readonly {
  family: Family;
  prefix: string;
  groups: readonly { label: string; group: string }[];
}[] = [
  { family: "divergent-universe", prefix: "04-差分宇宙", groups: [
    { label: "祝福", group: "blessing" }, { label: "方程", group: "equation" },
    { label: "奇物", group: "curio" }, { label: "加权奇物", group: "weighted-curio" },
    { label: "事件", group: "occurrence" }, { label: "教程", group: "tutorial" },
    { label: "概率博物馆", group: "probability-museum" }, { label: "运作记录", group: "operational-record" },
  ] },
  { family: "worldview", prefix: "05-世界观", groups: [
    { label: "星神", group: "aeon" }, { label: "命途", group: "path" },
    { label: "派系", group: "faction" }, { label: "地点", group: "location" },
    { label: "词条", group: "term" }, { label: "NPC", group: "npc" },
    { label: "敌人", group: "enemy" },
  ] },
  { family: "mission", prefix: "06-剧情", groups: [
    { label: "开拓任务", group: "trailblaze" }, { label: "同行任务", group: "companion" },
    { label: "冒险任务", group: "adventure" }, { label: "常驻活动剧情", group: "permanent-event" },
    { label: "限时活动剧情", group: "limited-event" },
  ] },
  { family: "collectible", prefix: "07-文本收藏", groups: [
    { label: "书籍与读物", group: "readable" }, { label: "物品背景", group: "inventory-item" },
    { label: "成就", group: "achievement" }, { label: "短信与聊天", group: "message" },
    { label: "唱片", group: "phonograph" }, { label: "教程", group: "tutorial" },
    { label: "其他", group: "other" },
  ] },
];

const REQUIRED_VOLUME_STEMS = [
  ...CORE_VOLUMES.keys(),
  ...LORE_TAXONOMY.map(({ prefix }) => `${prefix}-索引`),
];

export type VerifyOfflineWikiOptions = { outputRoot: string; releaseId: string };
export type VerificationReport = { releaseId: string; verifiedFiles: number; pages: number };

function checksum(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function metadataForFilename(filename: string): VolumeMetadata {
  const stem = filename.replace(/\.(?:html|pdf)$/u, "");
  const core = CORE_VOLUMES.get(stem);
  if (core) return core;
  for (const [familyIndex, definition] of LORE_TAXONOMY.entries()) {
    if (stem === `${definition.prefix}-索引`) {
      return { family: definition.family, group: "index", sortKey: [4 + familyIndex, 0] };
    }
    for (const [groupIndex, group] of definition.groups.entries()) {
      const match = new RegExp(`^${definition.prefix}-${group.label}-(\\d{3})$`, "u").exec(stem);
      if (match) {
        const part = Number(match[1]);
        if (part < 1) throw new Error(`PDF volume part must start at 001: ${filename}`);
        return { family: definition.family, group: group.group, sortKey: [4 + familyIndex, 1 + groupIndex, part] };
      }
    }
  }
  throw new Error(`build manifest contains a non-canonical volume filename: ${filename}`);
}

function compareSortKeys(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (left[index] ?? -1) - (right[index] ?? -1);
    if (difference !== 0) return difference;
  }
  return 0;
}

function sameNames(actual: string[], expected: string[]): boolean {
  return JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
}

export function verifyOfflineWiki(options: VerifyOfflineWikiOptions): VerificationReport {
  const buildRoot = join(options.outputRoot, "builds", options.releaseId);
  const manifest = BuildManifestSchema.parse(JSON.parse(readFileSync(join(buildRoot, "build-manifest.json"), "utf8")));
  if (manifest.releaseId !== options.releaseId) throw new Error("build manifest release does not match requested release");
  const inputNames = manifest.inputs.map((item) => item.filename);
  const outputNames = manifest.outputs.map((item) => item.filename);
  const expectedOutputNames = inputNames.map((filename) => filename.replace(/\.html$/, ".pdf"));
  const orders = manifest.outputs.map((item) => item.order);
  if (new Set(inputNames).size !== inputNames.length || new Set(outputNames).size !== outputNames.length) {
    throw new Error("build manifest filenames must be unique");
  }
  if (new Set(orders).size !== orders.length) throw new Error("build manifest output order must be unique");
  if (orders.some((order, index) => order !== index)) {
    throw new Error("build manifest output order must be unique and contiguous from zero");
  }
  if (JSON.stringify(outputNames) !== JSON.stringify(expectedOutputNames)
      || REQUIRED_VOLUME_STEMS.some((stem) => !outputNames.includes(`${stem}.pdf`))) {
    throw new Error("build manifest HTML/PDF volumes do not match the required canonical indexes");
  }

  const inputMetadata = inputNames.map(metadataForFilename);
  for (let index = 1; index < inputMetadata.length; index += 1) {
    if (compareSortKeys(inputMetadata[index - 1]!.sortKey, inputMetadata[index]!.sortKey) >= 0) {
      throw new Error("build manifest HTML inputs do not follow deterministic renderer order");
    }
  }
  for (const [index, output] of manifest.outputs.entries()) {
    const expected = inputMetadata[index]!;
    if (output.family !== expected.family || output.group !== expected.group) {
      throw new Error(`build manifest volume metadata mismatch: ${output.filename}`);
    }
  }

  const actualHtmlNames = readdirSync(join(buildRoot, "html")).filter((filename) => filename.endsWith(".html"));
  const actualPdfNames = readdirSync(join(buildRoot, "pdf")).filter((filename) => filename.endsWith(".pdf"));
  if (!sameNames(actualHtmlNames, inputNames) || !sameNames(actualPdfNames, outputNames)) {
    throw new Error("build directories do not exactly match manifest HTML/PDF volumes");
  }

  for (const input of manifest.inputs) {
    const bytes = readFileSync(join(buildRoot, "html", input.filename));
    if (checksum(bytes) !== input.checksum) throw new Error(`HTML checksum mismatch: ${input.filename}`);
  }
  let pages = 0;
  for (const output of manifest.outputs) {
    const bytes = readFileSync(join(buildRoot, "pdf", output.filename));
    if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error(`invalid PDF header: ${output.filename}`);
    if (checksum(bytes) !== output.checksum) throw new Error(`PDF checksum mismatch: ${output.filename}`);
    const pageCount = countPdfPages(bytes);
    if (pageCount !== output.pageCount) throw new Error(`PDF page count mismatch: ${output.filename}`);
    pages += pageCount;
  }
  return { releaseId: options.releaseId, verifiedFiles: manifest.outputs.length, pages };
}

function runCli(): void {
  const arguments_ = process.argv.slice(2);
  const releaseIndex = arguments_.indexOf("--release");
  const releaseId = releaseIndex === -1 ? undefined : arguments_[releaseIndex + 1];
  if (!releaseId) throw new Error("usage: npm run docs:verify -- --release <exact-release-id>");
  const report = verifyOfflineWiki({
    outputRoot: join(process.cwd(), ".local", "offline-wiki"),
    releaseId,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
