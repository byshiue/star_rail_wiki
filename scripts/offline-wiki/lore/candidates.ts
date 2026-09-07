import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { LoreFamilySchema, LoreRecordSchema, type LoreRecord } from "./schema";

const RELEASE_ID = "4.4-cn-2026-08-21" as const;
const RELEASE_VERSION = "4.4";
const RELEASE_SNAPSHOT_DATE = "2026-08-21";
const Sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const IsoDateSchema = z.iso.datetime({ offset: true });
const SemanticVersionSchema = z.string().regex(/^\d+\.\d+(?:\.\d+)?$/);

const RelationshipInputSchema = z.strictObject({
  type: z.enum(["located-in", "member-of", "follows", "requires", "features", "mentions", "related-to"]),
  targetLogicalId: z.string().regex(/^(?:lore|character|light-cone|relic-set):/),
  external: z.boolean(),
});

export const LoreCandidateSchema = z.strictObject({
  candidateId: z.string().regex(/^candidate:/),
  releaseId: z.literal(RELEASE_ID),
  family: LoreFamilySchema,
  kind: z.string().min(1),
  logicalId: z.string().regex(/^lore:/),
  name: z.string().min(1),
  aliases: z.array(z.string().min(1)),
  displayOrder: z.number().int().nonnegative().nullable(),
  locale: z.literal("zh-CN"),
  description: z.string().min(1).max(500),
  relationships: z.array(RelationshipInputSchema),
  mechanics: z.unknown().nullable(),
  sourceUrl: z.url().nullable(),
  evidenceIds: z.array(z.string().regex(/^evidence:/)),
});

export const CandidateEvidenceSchema = z.strictObject({
  evidenceId: z.string().regex(/^evidence:/),
  candidateId: z.string().regex(/^candidate:/),
  sourceName: z.string().min(1),
  sourceUrl: z.url(),
  sourceRevision: z.string().min(1),
  sourcePath: z.string().min(1),
  captureId: z.string().min(1),
  sourceVersion: SemanticVersionSchema.nullable(),
  publicationDate: z.iso.date().nullable(),
  accessedAt: IsoDateSchema,
  immutable: z.boolean(),
  facts: z.array(z.string().min(1).max(300)).min(1),
  contentChecksum: Sha256Schema,
});

export const CandidateLedgerSchema = z.strictObject({
  schemaVersion: z.literal(1),
  releaseId: z.literal(RELEASE_ID),
  locale: z.literal("zh-CN"),
  exhaustive: z.literal(false),
  accessedAt: IsoDateSchema,
  candidates: z.array(LoreCandidateSchema),
  evidence: z.array(CandidateEvidenceSchema),
});

export const CandidateDecisionStateSchema = z.enum([
  "admit",
  "reject-later-version",
  "reject-ambiguous-version",
  "missing-source",
]);

const CandidateRejectionSchema = z.strictObject({
  candidateId: z.string().regex(/^candidate:/),
  decision: CandidateDecisionStateSchema.exclude(["admit"]),
  reason: z.string().min(1).max(300),
  evidenceIds: z.array(z.string().regex(/^evidence:/)),
});

export const CandidateRejectionLedgerSchema = z.strictObject({
  schemaVersion: z.literal(1),
  releaseId: z.literal(RELEASE_ID),
  decisions: z.array(CandidateRejectionSchema),
});

export type LoreCandidate = z.infer<typeof LoreCandidateSchema>;
export type CandidateEvidence = z.infer<typeof CandidateEvidenceSchema>;
export type CandidateDecisionState = z.infer<typeof CandidateDecisionStateSchema>;
export type CandidateDecision = {
  candidateId: string;
  decision: CandidateDecisionState;
  reason: string;
  evidenceIds: string[];
  record?: LoreRecord;
};

function checksum(value: object): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;
}

function canonicalEvidence(value: CandidateEvidence): object {
  return {
    evidenceId: value.evidenceId,
    candidateId: value.candidateId,
    sourceName: value.sourceName,
    sourceUrl: value.sourceUrl,
    sourceRevision: value.sourceRevision,
    sourcePath: value.sourcePath,
    captureId: value.captureId,
    sourceVersion: value.sourceVersion,
    publicationDate: value.publicationDate,
    accessedAt: value.accessedAt,
    immutable: value.immutable,
    facts: value.facts,
  };
}

function canonicalRecord(record: LoreRecord): object {
  const common = {
    logicalId: record.logicalId,
    name: record.name,
    aliases: record.aliases,
    displayOrder: record.displayOrder,
    releaseId: record.releaseId,
    locale: record.locale,
    description: record.description,
    relationships: record.relationships.map(({ type, targetLogicalId, external }) => ({ type, targetLogicalId, external })),
    provenance: record.provenance.map(({ sourceName, sourceUrl, sourceRevision, sourcePath, sourceChecksum }) => ({ sourceName, sourceUrl, sourceRevision, sourcePath, sourceChecksum })),
    reviewStatus: record.reviewStatus,
    family: record.family,
    kind: record.kind,
  };
  return record.family === "divergent-universe" && record.mechanics !== undefined
    ? { ...common, mechanics: {
      rarity: record.mechanics.rarity,
      path: record.mechanics.path,
      activationRequirement: record.mechanics.activationRequirement,
      enhancementRequirement: record.mechanics.enhancementRequirement,
      effect: record.mechanics.effect,
      enhancedEffect: record.mechanics.enhancedEffect,
    } }
    : common;
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  const width = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < width; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

function recordFromCandidate(candidate: LoreCandidate, evidence: readonly CandidateEvidence[]): LoreRecord {
  const raw = {
    logicalId: candidate.logicalId,
    name: candidate.name,
    aliases: candidate.aliases,
    displayOrder: candidate.displayOrder,
    releaseId: candidate.releaseId,
    locale: candidate.locale,
    description: candidate.description,
    relationships: candidate.relationships,
    provenance: evidence.map((item) => ({
      sourceName: item.sourceName,
      sourceUrl: item.sourceUrl,
      sourceRevision: `${item.sourceRevision};${item.captureId}`,
      sourcePath: item.sourcePath,
      sourceChecksum: item.contentChecksum,
    })),
    reviewStatus: "reviewed" as const,
    family: candidate.family,
    kind: candidate.kind,
    ...(candidate.family === "divergent-universe" && candidate.mechanics !== null
      ? { mechanics: candidate.mechanics }
      : {}),
    contentChecksum: `sha256:${"0".repeat(64)}`,
  };
  let parsed: LoreRecord;
  try {
    parsed = LoreRecordSchema.parse(raw);
  } catch (error) {
    throw new Error(`candidate ${candidate.candidateId} cannot form a legal lore record taxonomy`, { cause: error });
  }
  return LoreRecordSchema.parse({ ...parsed, contentChecksum: checksum(canonicalRecord(parsed)) });
}

function uniqueIndex<T>(values: readonly T[], key: (value: T) => string, label: string): Map<string, T> {
  const result = new Map<string, T>();
  for (const value of values) {
    const id = key(value);
    if (result.has(id)) throw new Error(`duplicate ${label} ${id}`);
    result.set(id, value);
  }
  return result;
}

export function evaluateLoreCandidates(
  candidateInputs: readonly LoreCandidate[],
  evidenceInputs: readonly CandidateEvidence[],
): CandidateDecision[] {
  const candidates = candidateInputs.map((value) => LoreCandidateSchema.parse(value));
  const evidence = evidenceInputs.map((value) => CandidateEvidenceSchema.parse(value));
  uniqueIndex(candidates, (value) => value.candidateId, "candidate id");
  uniqueIndex(candidates, (value) => value.logicalId, "candidate logical id");
  uniqueIndex(candidates.filter((value) => value.sourceUrl !== null), (value) => value.sourceUrl!, "candidate url");
  const evidenceById = uniqueIndex(evidence, (value) => value.evidenceId, "evidence id");

  const evidenceReferenceCounts = new Map<string, number>();
  for (const candidate of candidates) {
    const uniqueEvidenceIds = new Set(candidate.evidenceIds);
    if (uniqueEvidenceIds.size !== candidate.evidenceIds.length) {
      throw new Error(`duplicate evidence reference for candidate ${candidate.candidateId}`);
    }
    for (const evidenceId of candidate.evidenceIds) {
      evidenceReferenceCounts.set(evidenceId, (evidenceReferenceCounts.get(evidenceId) ?? 0) + 1);
    }
  }
  for (const item of evidence) {
    if (evidenceReferenceCounts.get(item.evidenceId) !== 1) {
      throw new Error(`unreferenced or multiply referenced evidence ${item.evidenceId}`);
    }
  }

  for (const item of evidence) {
    if (checksum(canonicalEvidence(item)) !== item.contentChecksum) {
      throw new Error(`evidence checksum mismatch for ${item.evidenceId}`);
    }
  }

  return candidates.map((candidate) => {
    if (candidate.evidenceIds.length === 0) {
      return { candidateId: candidate.candidateId, decision: "missing-source", reason: "No entry-level official release evidence was found.", evidenceIds: [] };
    }
    const candidateEvidence = candidate.evidenceIds.map((id) => {
      const item = evidenceById.get(id);
      if (!item) throw new Error(`candidate ${candidate.candidateId} references missing evidence ${id}`);
      if (item.candidateId !== candidate.candidateId) throw new Error(`evidence ${id} belongs to candidate ${item.candidateId}, not ${candidate.candidateId}`);
      if (candidate.sourceUrl !== item.sourceUrl) throw new Error(`evidence ${id} source URL conflicts with candidate ${candidate.candidateId}`);
      return item;
    });
    const versions = new Set(candidateEvidence.map((item) => item.sourceVersion).filter((value) => value !== null));
    if (versions.size > 1) throw new Error(`conflicting evidence versions for candidate ${candidate.candidateId}`);
    const sourceVersion = candidateEvidence[0]?.sourceVersion;
    if (sourceVersion === undefined) throw new Error(`candidate ${candidate.candidateId} has no usable evidence`);
    if (sourceVersion !== null && compareVersions(sourceVersion, RELEASE_VERSION) > 0) {
      return { candidateId: candidate.candidateId, decision: "reject-later-version", reason: `Official evidence first identifies this entry in version ${sourceVersion}.`, evidenceIds: candidate.evidenceIds };
    }
    if (candidateEvidence.some((item) => item.sourceVersion === null || !item.immutable
      || item.publicationDate === null || item.publicationDate > RELEASE_SNAPSHOT_DATE)) {
      return { candidateId: candidate.candidateId, decision: "reject-ambiguous-version", reason: "The live/current source lacks immutable entry-level 4.4 evidence.", evidenceIds: candidate.evidenceIds };
    }
    const record = recordFromCandidate(candidate, candidateEvidence);
    return { candidateId: candidate.candidateId, decision: "admit", reason: `Immutable official evidence identifies the entry in version ${sourceVersion}.`, evidenceIds: candidate.evidenceIds, record };
  });
}

export function loreRecordsFromDecisions(decisions: readonly CandidateDecision[]): LoreRecord[] {
  return decisions.flatMap((decision) => decision.decision === "admit" && decision.record ? [decision.record] : []);
}

function main(): void {
  const arguments_ = process.argv.slice(2);
  const releaseId = arguments_[arguments_.indexOf("--release") + 1];
  const familyInput = arguments_[arguments_.indexOf("--family") + 1];
  if (releaseId !== RELEASE_ID || familyInput === undefined) {
    throw new Error(`usage: npx tsx scripts/offline-wiki/lore/candidates.ts --release ${RELEASE_ID} --family <family>`);
  }
  const family = LoreFamilySchema.parse(familyInput);
  const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  const dataRoot = join(repositoryRoot, "data", "offline-wiki", "lore", releaseId);
  const ledger = CandidateLedgerSchema.parse(JSON.parse(readFileSync(join(dataRoot, "candidates.json"), "utf8")));
  const expectedRejections = CandidateRejectionLedgerSchema.parse(JSON.parse(readFileSync(join(dataRoot, "rejections.json"), "utf8")));
  const decisions = evaluateLoreCandidates(ledger.candidates, ledger.evidence);
  const actualRejections = decisions.filter((decision) => decision.decision !== "admit").map(({ candidateId, decision, reason, evidenceIds }) => ({ candidateId, decision, reason, evidenceIds }));
  if (JSON.stringify(actualRejections) !== JSON.stringify(expectedRejections.decisions)) {
    throw new Error("candidate rejection ledger does not match deterministic evaluation");
  }
  const selected = decisions.filter((decision) => ledger.candidates.find((candidate) => candidate.candidateId === decision.candidateId)?.family === family);
  const counts = Object.fromEntries(CandidateDecisionStateSchema.options.map((state) => [state, selected.filter((decision) => decision.decision === state).length]));
  process.stdout.write(`${JSON.stringify({ releaseId, family, candidates: selected.length, counts })}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
