import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CandidateLedgerSchema,
  evaluateLoreCandidates,
  loreRecordsFromDecisions,
  runCandidateCli,
  validateCandidateProduction,
  type CandidateEvidence,
  type LoreCandidate,
} from "./candidates";

const RELEASE_ID = "4.4-cn-2026-08-21" as const;
const FIXTURE_ARTIFACT_CHECKSUM = `sha256:${createHash("sha256").update("short original fixture artifact", "utf8").digest("hex")}`;

function checksum(value: object): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;
}

function candidate(overrides: Partial<LoreCandidate> = {}): LoreCandidate {
  return {
    candidateId: "candidate:mission:planarcadia-whistle",
    releaseId: RELEASE_ID,
    family: "mission",
    kind: "trailblaze",
    logicalId: "lore:mission:trailblaze:planarcadia-whistle",
    name: "翁法罗斯—灾梦余音",
    aliases: [],
    displayOrder: null,
    locale: "zh-CN",
    description: "4.4 更新后永久开放的开拓任务。",
    relationships: [],
    mechanics: null,
    sourceUrl: "https://www.hoyolab.com/article/45851903",
    evidenceIds: ["evidence:official-4.4-update"],
    ...overrides,
  };
}

function evidence(overrides: Partial<CandidateEvidence> = {}): CandidateEvidence {
  const unsigned = {
    evidenceId: "evidence:official-4.4-update",
    candidateId: "candidate:mission:planarcadia-whistle",
    sourceName: "Honkai: Star Rail Version 4.4 Update Details",
    sourceUrl: "https://www.hoyolab.com/article/45851903",
    sourceRevision: "article:45851903",
    sourcePath: "version-update-details/new-story/planarcadia",
    captureId: "manual-fact-capture:2026-09-07:45851903:planarcadia",
    sourceVersion: "4.4",
    publishedAt: "2026-07-14T00:00:00+08:00",
    accessedAt: "2026-09-07T00:00:00.000Z",
    immutable: true,
    facts: ["Version 4.4", "Trailblaze Mission", "available after the Version 4.4 update"],
    sourceArtifactChecksum: FIXTURE_ARTIFACT_CHECKSUM,
    ...overrides,
  };
  return { ...unsigned, factCaptureChecksum: checksum(unsigned) };
}

describe("evaluateLoreCandidates", () => {
  it("rejects a current official directory without historical entry evidence as ambiguous", () => {
    const current = candidate({
      candidateId: "candidate:collectible:bookshelf-current",
      family: "collectible",
      kind: "readable",
      logicalId: "lore:collectible:readable:bookshelf-current",
      name: "当前书架目录候选",
      sourceUrl: "https://wiki.hoyolab.com/pc/hsr/aggregate/book",
      evidenceIds: ["evidence:bookshelf-current"],
    });
    const currentEvidence = evidence({
      evidenceId: "evidence:bookshelf-current",
      candidateId: current.candidateId,
      sourceName: "HoYoWiki Bookshelf current directory",
      sourceUrl: current.sourceUrl!,
      sourceRevision: "current-directory",
      sourcePath: "aggregate/book",
      captureId: "manual-directory-observation:2026-09-07",
      sourceVersion: null,
      immutable: false,
      facts: ["The current directory contains entries from an unbounded live catalog."],
    });

    expect(evaluateLoreCandidates([current], [currentEvidence])).toEqual([
      expect.objectContaining({ candidateId: current.candidateId, decision: "reject-ambiguous-version" }),
    ]);
  });

  it("compares semantic release numbers and rejects a 4.10 record as later", () => {
    const later = candidate({ candidateId: "candidate:du:arcadian-chronicles-4.5", family: "divergent-universe", kind: "tutorial", logicalId: "lore:du:tutorial:arcadian-chronicles-4.5", sourceUrl: "https://www.hoyolab.com/article/46375186", evidenceIds: ["evidence:du-4.5"] });
    const laterEvidence = evidence({ evidenceId: "evidence:du-4.5", candidateId: later.candidateId, sourceVersion: "4.10", sourceRevision: "article:46375186", sourceUrl: "https://www.hoyolab.com/article/46375186", sourcePath: "divergent-universe-4.5-update", captureId: "manual-fact-capture:2026-09-07:46375186", facts: ["Semantic-version fixture"] });
    expect(evaluateLoreCandidates([later], [laterEvidence])[0]).toMatchObject({ decision: "reject-later-version" });
  });

  it("admits immutable matching 4.4 evidence and converts only admits to checked lore records", () => {
    const decisions = evaluateLoreCandidates([candidate()], [evidence()]);
    expect(decisions[0]).toMatchObject({ decision: "admit" });
    const records = loreRecordsFromDecisions(decisions);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ releaseId: RELEASE_ID, family: "mission", reviewStatus: "reviewed" });
    expect(records[0]?.provenance[0]?.sourceChecksum).toBe(FIXTURE_ARTIFACT_CHECKSUM);
    expect(records[0]?.contentChecksum).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("does not admit factual release evidence without a hashed source artifact", () => {
    const factOnly = evidence({ sourceArtifactChecksum: null });
    expect(evaluateLoreCandidates([candidate()], [factOnly])[0]).toMatchObject({ decision: "missing-source" });
  });

  it("reports missing source evidence without admitting a record", () => {
    const missing = candidate({ candidateId: "candidate:worldview:missing", family: "worldview", kind: "term", logicalId: "lore:worldview:term:missing", evidenceIds: [] });
    const decisions = evaluateLoreCandidates([missing], []);
    expect(decisions).toEqual([expect.objectContaining({ decision: "missing-source" })]);
    expect(loreRecordsFromDecisions(decisions)).toEqual([]);
  });

  it("rejects duplicate candidate IDs, URLs, evidence IDs, and conflicting evidence ownership", () => {
    const first = candidate();
    expect(() => evaluateLoreCandidates([first, { ...first }], [evidence()])).toThrow(/duplicate candidate id/i);
    expect(() => evaluateLoreCandidates([first, candidate({ candidateId: "candidate:other", logicalId: "lore:mission:trailblaze:other" })], [evidence()])).toThrow(/duplicate candidate url/i);
    expect(() => evaluateLoreCandidates([first], [evidence(), evidence()])).toThrow(/duplicate evidence id/i);
    expect(() => evaluateLoreCandidates([first], [evidence({ candidateId: "candidate:other" })])).toThrow(/evidence.*candidate/i);
    expect(() => evaluateLoreCandidates([first, candidate({ candidateId: "candidate:other", logicalId: first.logicalId, sourceUrl: "https://www.hoyolab.com/article/other", evidenceIds: [] })], [evidence()])).toThrow(/duplicate.*logical/i);
    expect(() => evaluateLoreCandidates([{ ...first, evidenceIds: ["evidence:official-4.4-update", "evidence:official-4.4-update"] }], [evidence()])).toThrow(/duplicate.*evidence/i);
    expect(() => evaluateLoreCandidates([first], [evidence(), evidence({ evidenceId: "evidence:orphan", candidateId: "candidate:orphan", sourceUrl: "https://www.hoyolab.com/article/orphan" })])).toThrow(/unreferenced|orphan/i);
  });

  it.each([
    "2026-08-21T12:00:00+08:00",
    "2026-08-25T23:59:59+08:00",
  ])("admits evidence published before the fixed 4.4 end instant: %s", (publishedAt) => {
    expect(evaluateLoreCandidates([candidate()], [evidence({ publishedAt })])[0]).toMatchObject({ decision: "admit" });
  });

  it.each([
    "2026-08-26T06:00:00+08:00",
    "2026-08-26T06:00:01+08:00",
  ])("rejects evidence at or after the exclusive 4.4 end instant: %s", (publishedAt) => {
    expect(evaluateLoreCandidates([candidate()], [evidence({ publishedAt })])[0]).toMatchObject({ decision: "reject-ambiguous-version" });
  });

  it("is order-independent for mixed unknown and uniquely known later-version evidence", () => {
    const later = evidence({ evidenceId: "evidence:later", sourceVersion: "4.5" });
    const unknown = evidence({ evidenceId: "evidence:unknown", sourceVersion: null, immutable: false });
    const input = candidate({ evidenceIds: [later.evidenceId, unknown.evidenceId] });
    const forward = evaluateLoreCandidates([input], [later, unknown]);
    const reverse = evaluateLoreCandidates([{ ...input, evidenceIds: [...input.evidenceIds].reverse() }], [unknown, later]);
    expect(forward[0]).toMatchObject({ decision: "reject-later-version" });
    expect(reverse).toEqual(forward);
  });

  it("fails closed on different known versions and conflicting same-source identities", () => {
    const v44 = evidence({ evidenceId: "evidence:v44" });
    const v45 = evidence({ evidenceId: "evidence:v45", sourceVersion: "4.5", sourceUrl: v44.sourceUrl });
    const input = candidate({ evidenceIds: [v44.evidenceId, v45.evidenceId] });
    expect(evaluateLoreCandidates([input], [v44, v45])[0]).toMatchObject({ decision: "reject-ambiguous-version" });

    const conflict = evidence({ evidenceId: "evidence:conflict", sourceRevision: "different-revision" });
    expect(evaluateLoreCandidates([{ ...input, evidenceIds: [v44.evidenceId, conflict.evidenceId] }], [conflict, v44])[0]).toMatchObject({ decision: "reject-ambiguous-version" });
  });

  it("rejects checksum drift and invalid admitted taxonomy", () => {
    const drifted = { ...evidence(), facts: ["changed"] };
    expect(() => evaluateLoreCandidates([candidate()], [drifted])).toThrow(/evidence checksum/i);
    expect(() => evaluateLoreCandidates([candidate({ kind: "not-a-mission-kind" })], [evidence()])).toThrow(/taxonomy|record/i);
  });

  it("requires production records to exactly match one admitted record per family", () => {
    const input = candidate();
    const decisions = evaluateLoreCandidates([input], [evidence()]);
    const admitted = loreRecordsFromDecisions(decisions);
    expect(() => validateCandidateProduction("mission", [input], decisions, admitted)).not.toThrow();
    expect(() => validateCandidateProduction("mission", [input], decisions, [{ ...admitted[0]!, description: "drift" }])).toThrow(/checksum|match/i);
    expect(() => validateCandidateProduction("mission", [input], decisions, [...admitted, admitted[0]!])).toThrow(/extra|duplicate|match/i);
  });

  it("makes the CLI fail closed for drifted and extra production records", () => {
    const repositoryRoot = join(import.meta.dirname, "../../..");
    const temporaryRoot = mkdtempSync(join(tmpdir(), "lore-candidate-cli-"));
    const releaseRoot = join(temporaryRoot, "data/offline-wiki/lore", RELEASE_ID);
    cpSync(join(repositoryRoot, "data/offline-wiki/lore", RELEASE_ID), releaseRoot, { recursive: true });
    const admitted = loreRecordsFromDecisions(evaluateLoreCandidates([candidate()], [evidence()]))[0]!;
    const arguments_ = ["--release", RELEASE_ID, "--family", "mission"];

    writeFileSync(join(releaseRoot, "missions.json"), JSON.stringify([{ ...admitted, description: "drift" }]));
    expect(() => runCandidateCli(arguments_, temporaryRoot)).toThrow(/checksum/i);

    writeFileSync(join(releaseRoot, "missions.json"), JSON.stringify([admitted]));
    expect(() => runCandidateCli(arguments_, temporaryRoot)).toThrow(/exactly match/i);
  });

  it("locks the ledger to the exact 4.4 release and requires a non-exhaustive declaration", () => {
    const ledger = { schemaVersion: 1, releaseId: RELEASE_ID, locale: "zh-CN", exhaustive: false, accessedAt: "2026-09-07T00:00:00.000Z", candidates: [], evidence: [] };
    expect(CandidateLedgerSchema.parse(ledger)).toMatchObject({ releaseId: RELEASE_ID, exhaustive: false });
    expect(() => CandidateLedgerSchema.parse({ ...ledger, releaseId: "4.5-cn-2026-08-26" })).toThrow();
    expect(() => CandidateLedgerSchema.parse({ ...ledger, exhaustive: true })).toThrow();
  });
});
