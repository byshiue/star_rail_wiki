import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CandidateLedgerSchema,
  evaluateLoreCandidates,
  loreRecordsFromDecisions,
  type CandidateEvidence,
  type LoreCandidate,
} from "./candidates";

const RELEASE_ID = "4.4-cn-2026-08-21" as const;

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
    publicationDate: "2026-07-14",
    accessedAt: "2026-09-07T00:00:00.000Z",
    immutable: true,
    facts: ["Version 4.4", "Trailblaze Mission", "available after the Version 4.4 update"],
    ...overrides,
  };
  return { ...unsigned, contentChecksum: checksum(unsigned) };
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
    expect(records[0]?.contentChecksum).toMatch(/^sha256:[a-f0-9]{64}$/);
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

  it("does not use evidence published after the fixed release snapshot to admit an older version", () => {
    const tooLate = evidence({ publicationDate: "2026-08-22" });
    expect(evaluateLoreCandidates([candidate()], [tooLate])[0]).toMatchObject({ decision: "reject-ambiguous-version" });
  });

  it("rejects checksum drift and invalid admitted taxonomy", () => {
    const drifted = { ...evidence(), facts: ["changed"] };
    expect(() => evaluateLoreCandidates([candidate()], [drifted])).toThrow(/evidence checksum/i);
    expect(() => evaluateLoreCandidates([candidate({ kind: "not-a-mission-kind" })], [evidence()])).toThrow(/taxonomy|record/i);
  });

  it("locks the ledger to the exact 4.4 release and requires a non-exhaustive declaration", () => {
    const ledger = { schemaVersion: 1, releaseId: RELEASE_ID, locale: "zh-CN", exhaustive: false, accessedAt: "2026-09-07T00:00:00.000Z", candidates: [], evidence: [] };
    expect(CandidateLedgerSchema.parse(ledger)).toMatchObject({ releaseId: RELEASE_ID, exhaustive: false });
    expect(() => CandidateLedgerSchema.parse({ ...ledger, releaseId: "4.5-cn-2026-08-26" })).toThrow();
    expect(() => CandidateLedgerSchema.parse({ ...ledger, exhaustive: true })).toThrow();
  });
});
