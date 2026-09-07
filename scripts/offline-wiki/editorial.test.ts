import { describe, expect, it } from "vitest";
import { parseDivergentUniverseEntry, parseStorySummary } from "./editorial";

const provenance = {
  sourceName: "Official public wiki",
  sourceUrl: "https://wiki.hoyolab.com/pc/hsr/entry/1",
  sourceRevision: "2026-09-06",
  sourcePath: "entry/1",
  sourceChecksum: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
};

const reviewedSummary = {
  logicalId: "character:1",
  entityKind: "character",
  releaseId: "4.4-fixture",
  locale: "zh-CN",
  summary: "原创故事摘要。",
  contentChecksum: "sha256:ef3ad281972dbcdd4a2f01fd692a9eb7b606a65ed903772133d9dafa3e3c2bd9",
  reviewStatus: "reviewed",
  reviewer: { name: "Fixture reviewer", reviewedAt: "2026-09-06T01:00:00.000Z" },
  provenance: [provenance],
};

describe("offline wiki editorial records", () => {
  it("accepts a reviewed original summary whose checksum matches its text", () => {
    expect(parseStorySummary(reviewedSummary)).toMatchObject({
      logicalId: "character:1",
      locale: "zh-CN",
      reviewStatus: "reviewed",
    });
  });

  it("rejects draft summaries and summaries whose text changed after review", () => {
    expect(() => parseStorySummary({ ...reviewedSummary, reviewStatus: "draft" }))
      .toThrow();
    expect(() => parseStorySummary({ ...reviewedSummary, summary: "摘要被修改。" }))
      .toThrow(/checksum/i);
  });

  it("accepts checksummed Agent output without pretending it was reviewed", () => {
    const { reviewer: _reviewer, ...summaryBase } = reviewedSummary;
    const generatedSummary = {
      ...summaryBase,
      reviewStatus: "auto-generated",
      generator: { name: "Codex", generatedAt: "2026-09-07T03:00:00.000Z" },
    };

    expect(parseStorySummary(generatedSummary)).toMatchObject({
      logicalId: "character:1",
      reviewStatus: "auto-generated",
      generator: { name: "Codex" },
    });
  });

  it("requires a source for every Divergent Universe entry", () => {
    const entry = {
      logicalId: "du:equation:1",
      kind: "equation",
      name: "测试方程",
      releaseId: "4.4-fixture",
      description: "测试方程效果。",
      provenance: [],
      reviewStatus: "reviewed",
    };

    expect(() => parseDivergentUniverseEntry(entry)).toThrow(/provenance/i);
    expect(parseDivergentUniverseEntry({ ...entry, provenance: [provenance] }).name).toBe("测试方程");
  });
});
