import { z } from "zod";
import type { CanonicalLoreInput } from "../canonical";
import { readValidatedLocalLoreFile } from "../manifest";
import { normalizePlainText, sanitizeSavedHtml } from "../sanitize-html";
import type { AdapterInput, AdapterResult, ImportRejection, ImportRejectionDetail } from "./types";

const FAMILY_KINDS = {
  "divergent-universe": ["blessing", "equation", "curio", "weighted-curio", "occurrence", "tutorial", "probability-museum", "operational-record"],
  worldview: ["aeon", "path", "faction", "location", "term", "npc", "enemy"],
  mission: ["trailblaze", "companion", "adventure", "permanent-event", "limited-event"],
  collectible: ["readable", "inventory-item", "achievement", "message", "phonograph", "tutorial", "other"],
} as const;

const AggregateSchema = z.strictObject({
  releaseId: z.string().min(1).optional(),
  locale: z.literal("zh-CN"),
  entries: z.array(z.strictObject({ id: z.string().min(1), category: z.string().min(1), name: z.string().min(1) })),
});
const MappingSchema = z.strictObject({
  categories: z.record(z.string(), z.strictObject({ family: z.enum(["divergent-universe", "worldview", "mission", "collectible"]), kind: z.string().min(1) })),
  entries: z.record(z.string(), z.strictObject({ logicalId: z.string().regex(/^lore:[a-z0-9:-]+$/u), sourcePath: z.string().min(1) })),
});

const reject = (sourcePath: string, logicalId: string | null, reason: ImportRejection["reason"], detail: ImportRejectionDetail): ImportRejection => ({ sourcePath, logicalId, reason, detail });
const parseJson = (text: string): unknown => JSON.parse(text) as unknown;

function sectionsFromHtml(html: string): CanonicalLoreInput["sections"] {
  const blocks = sanitizeSavedHtml(html);
  let title: string | null = null;
  const sections: CanonicalLoreInput["sections"] = [];
  for (const block of blocks) {
    if (block.label === "heading") {
      title = block.text;
      continue;
    }
    sections.push({ order: sections.length, title, speaker: null, branch: null, body: block.text });
  }
  return sections;
}

export function convertSavedHoyoWiki({ manifest, sourceRoot }: AdapterInput): AdapterResult {
  const aggregatePath = "aggregate-list.json";
  const mappingPath = "category-mapping.json";
  const declared = new Set(manifest.files.map((file) => file.path));
  if (!declared.has(aggregatePath) || !declared.has(mappingPath)) {
    return { entries: [], rejections: [reject(aggregatePath, null, "malformed-source", "required-layout-missing")] };
  }
  let aggregate: z.infer<typeof AggregateSchema>;
  let mapping: z.infer<typeof MappingSchema>;
  try {
    aggregate = AggregateSchema.parse(parseJson(readValidatedLocalLoreFile(manifest, sourceRoot, aggregatePath).text));
    mapping = MappingSchema.parse(parseJson(readValidatedLocalLoreFile(manifest, sourceRoot, mappingPath).text));
  } catch {
    return { entries: [], rejections: [reject(aggregatePath, null, "malformed-source", "invalid-directory-json")] };
  }
  if (aggregate.releaseId !== manifest.releaseId || aggregate.locale !== manifest.locale) {
    return { entries: [], rejections: [reject(aggregatePath, null, "ambiguous-release", "release-evidence-mismatch")] };
  }

  const entries: AdapterResult["entries"] = [];
  const rejections: ImportRejection[] = [];
  for (const sourceEntry of aggregate.entries) {
    const binding = mapping.entries[sourceEntry.id];
    if (!binding) {
      rejections.push(reject(aggregatePath, null, "malformed-source", "entry-not-declared"));
      continue;
    }
    const category = mapping.categories[sourceEntry.category];
    if (!category || !(FAMILY_KINDS[category.family] as readonly string[]).includes(category.kind)) {
      rejections.push(reject(aggregatePath, binding.logicalId, "unknown-kind", "category-not-mapped"));
      continue;
    }
    if (!manifest.families.includes(category.family) || !declared.has(binding.sourcePath)) {
      rejections.push(reject(aggregatePath, binding.logicalId, "malformed-source", "entry-file-not-declared"));
      continue;
    }
    let sections: CanonicalLoreInput["sections"];
    try {
      sections = sectionsFromHtml(readValidatedLocalLoreFile(manifest, sourceRoot, binding.sourcePath).text);
    } catch {
      rejections.push(reject(binding.sourcePath, binding.logicalId, "malformed-source", "entry-read-failed"));
      continue;
    }
    if (sections.length === 0) {
      rejections.push(reject(binding.sourcePath, binding.logicalId, "missing-text", "no-allowlisted-text"));
      continue;
    }
    const name = normalizePlainText(sourceEntry.name);
    if (name.length === 0) {
      rejections.push(reject(aggregatePath, binding.logicalId, "missing-text", "display-name-empty"));
      continue;
    }
    entries.push({ sourcePath: binding.sourcePath, input: {
      logicalId: binding.logicalId, family: category.family, kind: category.kind, name,
      releaseId: manifest.releaseId, locale: manifest.locale, sourceRevision: manifest.source.revision, sections,
    } });
  }
  return { entries, rejections };
}
