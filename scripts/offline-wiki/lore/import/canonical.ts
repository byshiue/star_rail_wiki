import { createHash } from "node:crypto";
import { z } from "zod";
import { LoreFamilySchema, type LoreFamily } from "../schema";
import type { LocalLoreManifest } from "./manifest";

const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
type Sha256 = `sha256:${string}`;

const LoreKinds: Record<LoreFamily, ReadonlySet<string>> = {
  "divergent-universe": new Set(["blessing", "equation", "curio", "weighted-curio", "occurrence", "tutorial", "probability-museum", "operational-record"]),
  worldview: new Set(["aeon", "path", "faction", "location", "term", "npc", "enemy"]),
  mission: new Set(["trailblaze", "companion", "adventure", "permanent-event", "limited-event"]),
  collectible: new Set(["readable", "inventory-item", "achievement", "message", "phonograph", "tutorial", "other"]),
};

const CanonicalSectionSchema = z.strictObject({
  order: z.number().int().nonnegative(),
  title: z.string().min(1).nullable(),
  speaker: z.string().min(1).nullable(),
  branch: z.string().min(1).nullable(),
  body: z.string().refine((body) => body.trim().length > 0, "section body must not be empty"),
});

const CanonicalLoreInputSchema = z.strictObject({
  logicalId: z.string().regex(/^lore:/),
  family: LoreFamilySchema,
  kind: z.string().min(1),
  name: z.string().min(1),
  releaseId: z.string().min(1).optional(),
  locale: z.literal("zh-CN").optional(),
  sourceRevision: z.string().min(1).optional(),
  sections: z.array(CanonicalSectionSchema).min(1),
}).superRefine(({ family, kind }, context) => {
  if (!LoreKinds[family].has(kind)) {
    context.addIssue({ code: "custom", path: ["kind"], message: `kind ${kind} is not valid for ${family}` });
  }
});

export type CanonicalLoreInput = z.infer<typeof CanonicalLoreInputSchema>;

export const LocalFullTextRecordSchema = z.strictObject({
  logicalId: z.string().regex(/^lore:/), family: LoreFamilySchema, kind: z.string().min(1), name: z.string().min(1),
  releaseId: z.string().min(1), locale: z.literal("zh-CN"), sourceRevision: z.string().min(1), sourcePath: z.string().min(1),
  sourceChecksum: Sha256Schema, sections: z.array(CanonicalSectionSchema).min(1), inputChecksum: Sha256Schema,
  contentChecksum: Sha256Schema, importedAt: z.iso.datetime(), adapterVersion: z.number().int().positive(),
}).superRefine(({ family, kind }, context) => {
  if (!LoreKinds[family].has(kind)) context.addIssue({ code: "custom", path: ["kind"], message: `kind ${kind} is not valid for ${family}` });
});
export type LocalFullTextRecord = z.infer<typeof LocalFullTextRecordSchema> & { sourceChecksum: Sha256; inputChecksum: Sha256; contentChecksum: Sha256 };

function checksum(value: string): Sha256 {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function parseLine(line: string, lineNumber: number): CanonicalLoreInput {
  let candidate: unknown;
  try {
    candidate = JSON.parse(line);
  } catch {
    throw new Error(`canonical JSONL line ${lineNumber} is not valid JSON`);
  }
  if (candidate === null || Array.isArray(candidate) || typeof candidate !== "object") {
    throw new Error(`canonical JSONL line ${lineNumber} must be a JSON object record`);
  }
  try {
    return CanonicalLoreInputSchema.parse(candidate);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "invalid record";
    throw new Error(`canonical JSONL line ${lineNumber} is invalid: ${detail}`);
  }
}

function validateManifestBinding(input: CanonicalLoreInput, manifest: LocalLoreManifest): void {
  if (!manifest.families.includes(input.family)) {
    throw new Error(`canonical record family ${input.family} is not declared by the manifest`);
  }
  if (input.releaseId !== undefined && input.releaseId !== manifest.releaseId) {
    throw new Error(`canonical record release ${input.releaseId} does not match the manifest`);
  }
  if (input.locale !== undefined && input.locale !== manifest.locale) {
    throw new Error(`canonical record locale ${input.locale} does not match the manifest`);
  }
  if (input.sourceRevision !== undefined && input.sourceRevision !== manifest.source.revision) {
    throw new Error(`canonical record source revision does not match the manifest`);
  }
}

function normalizeInput(input: CanonicalLoreInput): CanonicalLoreInput {
  const sections = input.sections
    .map((section) => ({
      order: section.order,
      title: section.title === null ? null : normalizeNewlines(section.title),
      speaker: section.speaker === null ? null : normalizeNewlines(section.speaker),
      branch: section.branch === null ? null : normalizeNewlines(section.branch),
      body: normalizeNewlines(section.body),
    }))
    .sort((left, right) => left.order - right.order);
  const seenOrders = new Set<number>();
  for (const section of sections) {
    if (seenOrders.has(section.order)) {
      throw new Error(`canonical record ${input.logicalId} has duplicate section order ${section.order}`);
    }
    seenOrders.add(section.order);
  }
  return {
    logicalId: input.logicalId,
    family: input.family,
    kind: input.kind,
    name: normalizeNewlines(input.name),
    ...(input.releaseId === undefined ? {} : { releaseId: input.releaseId }),
    ...(input.locale === undefined ? {} : { locale: input.locale }),
    ...(input.sourceRevision === undefined ? {} : { sourceRevision: input.sourceRevision }),
    sections,
  };
}

function inputChecksumFields(input: CanonicalLoreInput) {
  return {
    logicalId: input.logicalId,
    family: input.family,
    kind: input.kind,
    name: input.name,
    sections: input.sections,
  };
}

export function parseCanonicalLoreJsonl(
  text: string,
  manifest: LocalLoreManifest,
): LocalFullTextRecord[] {
  if (manifest.files.length !== 1) {
    throw new Error("canonical-jsonl manifests must declare exactly one input file");
  }
  const manifestFile = manifest.files[0];
  const records: LocalFullTextRecord[] = [];
  const logicalIds = new Set<string>();
  const lines = normalizeNewlines(text).split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.length === 0) continue;
    const input = normalizeInput(parseLine(line, index + 1));
    if (logicalIds.has(input.logicalId)) {
      throw new Error(`duplicate canonical logicalId: ${input.logicalId}`);
    }
    logicalIds.add(input.logicalId);
    validateManifestBinding(input, manifest);
    const canonicalFields = {
      logicalId: input.logicalId,
      family: input.family,
      kind: input.kind,
      name: input.name,
      releaseId: manifest.releaseId,
      locale: manifest.locale,
      sourceRevision: manifest.source.revision,
      sourcePath: manifestFile.path,
      sourceChecksum: Sha256Schema.parse(manifestFile.checksum) as Sha256,
      sections: input.sections,
      inputChecksum: checksum(JSON.stringify(inputChecksumFields(input))),
      importedAt: manifest.source.exportedAt,
      adapterVersion: manifest.adapterVersion,
    } satisfies Omit<LocalFullTextRecord, "contentChecksum">;
    const contentChecksum = checksum(JSON.stringify(canonicalFields));
    records.push({
      logicalId: canonicalFields.logicalId,
      family: canonicalFields.family,
      kind: canonicalFields.kind,
      name: canonicalFields.name,
      releaseId: canonicalFields.releaseId,
      locale: canonicalFields.locale,
      sourceRevision: canonicalFields.sourceRevision,
      sourcePath: canonicalFields.sourcePath,
      sourceChecksum: canonicalFields.sourceChecksum,
      sections: canonicalFields.sections,
      inputChecksum: canonicalFields.inputChecksum,
      contentChecksum,
      importedAt: canonicalFields.importedAt,
      adapterVersion: canonicalFields.adapterVersion,
    });
  }
  return records;
}

export function serializeCanonicalLoreRecords(records: readonly LocalFullTextRecord[]): string {
  return records.length === 0 ? "" : `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

export function validateLocalFullTextRecords(records: readonly LocalFullTextRecord[]): void {
  for (const record of records) {
    const parsed = LocalFullTextRecordSchema.parse(record) as LocalFullTextRecord;
    const { contentChecksum, ...canonicalFields } = parsed;
    if (checksum(JSON.stringify(canonicalFields)) !== contentChecksum) {
      throw new Error(`normalized lore content checksum mismatch for ${record.logicalId}`);
    }
  }
}

export type { LoreFamily };
