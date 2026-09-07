import { z } from "zod";
import type { CanonicalLoreInput } from "../canonical";
import { readValidatedLocalLoreFile } from "../manifest";
import { normalizePlainText } from "../sanitize-html";
import type { AdapterInput, AdapterResult, ImportRejection, ImportRejectionDetail } from "./types";

const PATHS = {
  excel: "ExcelOutput/LoreEntries.json",
  textMap: "TextMap/TextMapCHS.json",
  story: "Story/Story.json",
} as const;
const FAMILY_KINDS = {
  "divergent-universe": ["blessing", "equation", "curio", "weighted-curio", "occurrence", "tutorial", "probability-museum", "operational-record"],
  worldview: ["aeon", "path", "faction", "location", "term", "npc", "enemy"],
  mission: ["trailblaze", "companion", "adventure", "permanent-event", "limited-event"],
  collectible: ["readable", "inventory-item", "achievement", "message", "phonograph", "tutorial", "other"],
} as const;
const FamilySchema = z.enum(["divergent-universe", "worldview", "mission", "collectible"]);
const ExcelSchema = z.strictObject({
  releaseId: z.string().min(1).optional(), locale: z.literal("zh-CN"),
  rows: z.array(z.strictObject({ id: z.string().min(1), logicalId: z.string().regex(/^lore:[a-z0-9:-]+$/u), family: FamilySchema, kind: z.string().min(1), nameHash: z.string().min(1), storyId: z.string().min(1) })),
});
const TextMapSchema = z.record(z.string(), z.string());
const StorySchema = z.strictObject({ stories: z.array(z.strictObject({
  id: z.string().min(1),
  sections: z.array(z.strictObject({ order: z.number().int().nonnegative(), titleHash: z.string().min(1).optional(), speakerHash: z.string().min(1).optional(), branch: z.string().min(1).nullable().optional(), bodyHash: z.string().min(1) })),
})) });
const reject = (sourcePath: string, logicalId: string | null, reason: ImportRejection["reason"], detail: ImportRejectionDetail): ImportRejection => ({ sourcePath, logicalId, reason, detail });

export function convertCompatibleGameData({ manifest, sourceRoot }: AdapterInput): AdapterResult {
  const declared = new Set(manifest.files.map((file) => file.path));
  if (Object.values(PATHS).some((path) => !declared.has(path))) {
    return { entries: [], rejections: [reject(PATHS.excel, null, "malformed-source", "required-layout-missing")] };
  }
  let excel: z.infer<typeof ExcelSchema>;
  let textMap: z.infer<typeof TextMapSchema>;
  let storyData: z.infer<typeof StorySchema>;
  try {
    excel = ExcelSchema.parse(JSON.parse(readValidatedLocalLoreFile(manifest, sourceRoot, PATHS.excel).text));
    textMap = TextMapSchema.parse(JSON.parse(readValidatedLocalLoreFile(manifest, sourceRoot, PATHS.textMap).text));
    storyData = StorySchema.parse(JSON.parse(readValidatedLocalLoreFile(manifest, sourceRoot, PATHS.story).text));
  } catch {
    return { entries: [], rejections: [reject(PATHS.excel, null, "malformed-source", "invalid-table-json")] };
  }
  if (excel.releaseId !== manifest.releaseId || excel.locale !== manifest.locale) {
    return { entries: [], rejections: [reject(PATHS.excel, null, "ambiguous-release", "release-evidence-mismatch")] };
  }
  const stories = new Map(storyData.stories.map((story) => [story.id, story]));
  const entries: AdapterResult["entries"] = [];
  const rejections: ImportRejection[] = [];
  for (const row of excel.rows) {
    if (!manifest.families.includes(row.family) || !(FAMILY_KINDS[row.family] as readonly string[]).includes(row.kind)) {
      rejections.push(reject(PATHS.excel, row.logicalId, "unknown-kind", "row-kind-not-approved"));
      continue;
    }
    const story = stories.get(row.storyId);
    if (!story) {
      rejections.push(reject(PATHS.story, row.logicalId, "missing-text", "story-not-found"));
      continue;
    }
    const rawName = textMap[row.nameHash];
    const name = rawName === undefined ? undefined : normalizePlainText(rawName);
    const sections: CanonicalLoreInput["sections"] = [];
    let missingText = name === undefined;
    for (const section of [...story.sections].sort((left, right) => left.order - right.order)) {
      const rawBody = textMap[section.bodyHash];
      const rawTitle = section.titleHash === undefined ? null : textMap[section.titleHash];
      const rawSpeaker = section.speakerHash === undefined ? null : textMap[section.speakerHash];
      const body = rawBody === undefined ? undefined : normalizePlainText(rawBody);
      const title = rawTitle === undefined || rawTitle === null ? rawTitle : normalizePlainText(rawTitle);
      const speaker = rawSpeaker === undefined || rawSpeaker === null ? rawSpeaker : normalizePlainText(rawSpeaker);
      const branch = section.branch === undefined || section.branch === null ? null : normalizePlainText(section.branch);
      if (body === undefined || body.length === 0 || title === undefined || title === "" || speaker === undefined || speaker === "" || (section.branch != null && branch === "")) {
        missingText = true;
        continue;
      }
      sections.push({ order: section.order, title, speaker, branch, body });
    }
    if (missingText || name === undefined || name.length === 0) {
      rejections.push(reject(PATHS.story, row.logicalId, "missing-text", "referenced-text-missing"));
      continue;
    }
    entries.push({ sourcePath: PATHS.story, input: {
      logicalId: row.logicalId, family: row.family, kind: row.kind, name,
      releaseId: manifest.releaseId, locale: manifest.locale, sourceRevision: manifest.source.revision, sections,
    } });
  }
  return { entries, rejections };
}
