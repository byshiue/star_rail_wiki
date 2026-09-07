import { describe, expect, it } from "vitest";
import { StorySummarySchema } from "../schema";
import { LoreBaselineSchema, LoreRecordSchema } from "./schema";

const provenance = [{
  sourceName: "Official fixture",
  sourceUrl: "https://wiki.hoyolab.com/pc/hsr/entry/1",
  sourceRevision: "fixture-revision",
  sourcePath: "entry/1",
  sourceChecksum: `sha256:${"a".repeat(64)}`,
}];

const commonRecord = {
  aliases: [],
  releaseId: "4.4-fixture",
  locale: "zh-CN",
  description: "简短说明。",
  relationships: [],
  provenance,
  reviewStatus: "reviewed",
  contentChecksum: `sha256:${"b".repeat(64)}`,
} as const;

describe("LoreRecordSchema", () => {
  it("parses a divergent-universe equation", () => {
    expect(LoreRecordSchema.parse({
      ...commonRecord,
      logicalId: "lore:du:equation:1",
      family: "divergent-universe",
      kind: "equation",
      name: "测试方程",
      description: "短机制说明。",
      mechanics: { rarity: 3, path: "巡猎", effect: "测试效果。", enhancedEffect: null },
    })).toMatchObject({ family: "divergent-universe", kind: "equation" });
  });

  it.each([
    {
      logicalId: "lore:worldview:faction:1",
      family: "worldview",
      kind: "faction",
      name: "测试派系",
    },
    {
      logicalId: "lore:mission:companion:1",
      family: "mission",
      kind: "companion",
      name: "测试同行任务",
    },
    {
      logicalId: "lore:collectible:readable:1",
      family: "collectible",
      kind: "readable",
      name: "测试读物",
    },
  ] as const)("parses a $family/$kind record", ({ family, kind, ...record }) => {
    expect(LoreRecordSchema.parse({ ...commonRecord, ...record, family, kind })).toMatchObject({ family, kind });
  });

  it("rejects mechanics on a mission", () => {
    expect(() => LoreRecordSchema.parse({
      ...commonRecord,
      logicalId: "lore:mission:companion:1",
      family: "mission",
      kind: "companion",
      name: "测试同行任务",
      mechanics: { rarity: 3, path: "巡猎", effect: "测试效果。", enhancedEffect: null },
    })).toThrow();
  });

  it("rejects an unknown relationship type", () => {
    expect(() => LoreRecordSchema.parse({
      ...commonRecord,
      logicalId: "lore:worldview:faction:1",
      family: "worldview",
      kind: "faction",
      name: "测试派系",
      relationships: [{ type: "owns", targetLogicalId: "lore:worldview:location:1" }],
    })).toThrow();
  });

  it("rejects a relationship target outside the supported namespaces", () => {
    expect(() => LoreRecordSchema.parse({
      ...commonRecord,
      logicalId: "lore:worldview:faction:1",
      family: "worldview",
      kind: "faction",
      name: "测试派系",
      relationships: [{ type: "located-in", targetLogicalId: "bad-id" }],
    })).toThrow();
  });

  it("rejects a non-Chinese locale", () => {
    expect(() => LoreRecordSchema.parse({
      ...commonRecord,
      logicalId: "lore:worldview:faction:1",
      family: "worldview",
      kind: "faction",
      name: "测试派系",
      locale: "en-US",
    })).toThrow();
  });

  it("rejects an empty provenance array", () => {
    expect(() => LoreRecordSchema.parse({
      ...commonRecord,
      logicalId: "lore:worldview:faction:1",
      family: "worldview",
      kind: "faction",
      name: "测试派系",
      provenance: [],
    })).toThrow();
  });

  it("rejects a malformed provenance source checksum", () => {
    expect(() => LoreRecordSchema.parse({
      ...commonRecord,
      logicalId: "lore:worldview:faction:1",
      family: "worldview",
      kind: "faction",
      name: "测试派系",
      provenance: [{ ...provenance[0], sourceChecksum: "fixture-checksum" }],
    })).toThrow();
  });
});

describe("LoreBaselineSchema", () => {
  it("accepts complete and missing baselines with their required evidence", () => {
    expect(LoreBaselineSchema.parse({
      releaseId: "4.4-fixture",
      family: "worldview",
      baselineStatus: "complete",
      expectedCount: 1,
      provenance,
      contentChecksum: `sha256:${"c".repeat(64)}`,
    })).toMatchObject({ baselineStatus: "complete", expectedCount: 1 });

    expect(LoreBaselineSchema.parse({
      releaseId: "4.4-fixture",
      family: "mission",
      baselineStatus: "missing",
      expectedCount: null,
      provenance: [],
      contentChecksum: `sha256:${"d".repeat(64)}`,
    })).toMatchObject({ baselineStatus: "missing", expectedCount: null });
  });

  it("rejects a complete baseline without an expected count", () => {
    expect(() => LoreBaselineSchema.parse({
      releaseId: "4.4-fixture",
      family: "mission",
      baselineStatus: "complete",
      expectedCount: null,
      provenance,
      contentChecksum: `sha256:${"d".repeat(64)}`,
    })).toThrow();
  });

  it("rejects a complete baseline without provenance", () => {
    expect(() => LoreBaselineSchema.parse({
      releaseId: "4.4-fixture",
      family: "mission",
      baselineStatus: "complete",
      expectedCount: 1,
      provenance: [],
      contentChecksum: `sha256:${"d".repeat(64)}`,
    })).toThrow();
  });

  it("rejects a malformed provenance source checksum", () => {
    expect(() => LoreBaselineSchema.parse({
      releaseId: "4.4-fixture",
      family: "mission",
      baselineStatus: "complete",
      expectedCount: 1,
      provenance: [{ ...provenance[0], sourceChecksum: "fixture-checksum" }],
      contentChecksum: `sha256:${"d".repeat(64)}`,
    })).toThrow();
  });
});

describe("StorySummarySchema lore entities", () => {
  const reviewedSummary = {
    logicalId: "lore:worldview:faction:1",
    entityKind: "lore",
    releaseId: "4.4-fixture",
    locale: "zh-CN",
    summary: "原创摘要。",
    contentChecksum: `sha256:${"e".repeat(64)}`,
    provenance,
    reviewStatus: "reviewed",
    reviewer: { name: "Fixture reviewer", reviewedAt: "2026-09-06T00:00:00.000Z" },
  } as const;

  it("accepts lore logical IDs", () => {
    expect(StorySummarySchema.parse(reviewedSummary)).toMatchObject({
      entityKind: "lore",
      logicalId: "lore:worldview:faction:1",
    });
  });

  it("retains rejection of unrecognized entity kinds", () => {
    expect(() => StorySummarySchema.parse({ ...reviewedSummary, entityKind: "unknown" })).toThrow();
  });
});
