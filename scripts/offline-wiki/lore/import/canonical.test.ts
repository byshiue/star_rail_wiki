import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { LocalLoreManifest } from "./manifest";
import { parseCanonicalLoreJsonl, validateLocalFullTextRecords } from "./canonical";

const FILE_CHECKSUM = `sha256:${"a".repeat(64)}` as const;

const manifest: LocalLoreManifest = {
  schemaVersion: 1,
  releaseId: "4.4-fixture",
  locale: "zh-CN",
  source: {
    name: "User-provided fixture export",
    revision: "fixture-revision",
    exportedAt: "2026-09-06T00:00:00.000Z",
  },
  adapter: "canonical-jsonl",
  adapterVersion: 1,
  families: ["worldview"],
  userProvided: true,
  files: [{ path: "worldview.jsonl", bytes: 128, checksum: FILE_CHECKSUM }],
};

function hash(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function record(overrides: Record<string, unknown> = {}) {
  return {
    logicalId: "lore:worldview:faction:1",
    family: "worldview",
    kind: "faction",
    name: "测试派系",
    releaseId: manifest.releaseId,
    locale: manifest.locale,
    sourceRevision: manifest.source.revision,
    sections: [
      { order: 2, title: null, speaker: "乙", branch: "B", body: "第二行\r\n文本" },
      { order: 1, title: "开篇", speaker: null, branch: "A", body: "第一行\r\n文本" },
    ],
    ...overrides,
  };
}

describe("parseCanonicalLoreJsonl", () => {
  it("normalizes CRLF, orders sections, preserves branches, and verifies a canonical checksum", () => {
    const parsed = parseCanonicalLoreJsonl(`${JSON.stringify(record())}\r\n`, manifest);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].sections.map(({ order, branch, body }) => ({ order, branch, body }))).toEqual([
      { order: 1, branch: "A", body: "第一行\n文本" },
      { order: 2, branch: "B", body: "第二行\n文本" },
    ]);
    expect(parsed[0]).toMatchObject({
      sourcePath: manifest.files[0].path,
      sourceChecksum: manifest.files[0].checksum,
      sourceDependencies: [{ path: manifest.files[0].path, checksum: manifest.files[0].checksum }],
      importedAt: manifest.source.exportedAt,
      adapterVersion: manifest.adapterVersion,
    });
    const { contentChecksum, ...canonicalFields } = parsed[0];
    expect(contentChecksum).toBe(hash(JSON.stringify(canonicalFields)));
  });

  it("covers the complete sorted source dependency set in the content checksum", () => {
    const parsed = parseCanonicalLoreJsonl(JSON.stringify(record()), manifest)[0];
    const mutated = structuredClone(parsed);
    mutated.sourceDependencies[0].checksum = `sha256:${"b".repeat(64)}`;
    expect(() => validateLocalFullTextRecords([mutated])).toThrow(/content checksum|primary|dependenc/i);
  });

  it("derives input checksums from fixed-order normalized raw fields regardless of input key order", () => {
    const original = record();
    const reordered = Object.fromEntries(Object.entries(original).reverse());
    const left = parseCanonicalLoreJsonl(JSON.stringify(original), manifest)[0];
    const right = parseCanonicalLoreJsonl(JSON.stringify(reordered), manifest)[0];
    expect(left.inputChecksum).toBe(right.inputChecksum);
    expect(left.inputChecksum).not.toBe(manifest.files[0].checksum);
  });

  it("requires exactly one manifest input to bind source identity without guessing", () => {
    const multiple = {
      ...manifest,
      files: [...manifest.files, { path: "other.jsonl", bytes: 1, checksum: `sha256:${"b".repeat(64)}` }],
    };
    expect(() => parseCanonicalLoreJsonl(JSON.stringify(record()), multiple)).toThrow(/exactly one|single/i);
  });

  it("rejects non-objects and malformed JSON lines", () => {
    expect(() => parseCanonicalLoreJsonl("[]\n", manifest)).toThrow(/object|record/i);
    expect(() => parseCanonicalLoreJsonl("{bad}\n", manifest)).toThrow(/line 1|JSON/i);
  });

  it("treats a whitespace-only line as a non-empty invalid JSON value", () => {
    expect(() => parseCanonicalLoreJsonl("   \n", manifest)).toThrow(/line 1|JSON/i);
  });

  it("rejects empty section bodies", () => {
    const invalid = record({ sections: [{ order: 1, title: null, speaker: null, branch: null, body: "" }] });
    expect(() => parseCanonicalLoreJsonl(JSON.stringify(invalid), manifest)).toThrow(/body/i);
  });

  it("rejects kinds outside the approved taxonomy for a family", () => {
    expect(() => parseCanonicalLoreJsonl(
      JSON.stringify(record({ kind: "companion" })),
      manifest,
    )).toThrow(/kind/i);
  });

  it("rejects duplicate logical IDs", () => {
    const line = JSON.stringify(record());
    expect(() => parseCanonicalLoreJsonl(`${line}\n${line}\n`, manifest)).toThrow(/duplicate.*logical/i);
  });

  it("rejects duplicate section order without flattening branches", () => {
    const invalid = record({ sections: [
      { order: 1, title: null, speaker: null, branch: "A", body: "甲" },
      { order: 1, title: null, speaker: null, branch: "B", body: "乙" },
    ] });
    expect(() => parseCanonicalLoreJsonl(JSON.stringify(invalid), manifest)).toThrow(/duplicate.*order/i);
  });

  it.each([
    ["releaseId", "4.5-cn-2026-09-01", /release/i],
    ["locale", "en-US", /locale/i],
    ["sourceRevision", "other", /revision/i],
  ])("rejects manifest mismatch in %s", (field, value, message) => {
    expect(() => parseCanonicalLoreJsonl(JSON.stringify(record({ [field]: value })), manifest)).toThrow(message);
  });

  it("rejects a valid family/kind pair not declared by the manifest", () => {
    expect(() => parseCanonicalLoreJsonl(
      JSON.stringify(record({ family: "mission", kind: "companion" })),
      manifest,
    )).toThrow(/family/i);
  });

  it("rejects caller-supplied derived checksums and unknown fields", () => {
    expect(() => parseCanonicalLoreJsonl(JSON.stringify(record({ contentChecksum: FILE_CHECKSUM })), manifest)).toThrow(/unrecognized|contentChecksum|invalid/i);
    expect(() => parseCanonicalLoreJsonl(JSON.stringify(record({ unexpected: true })), manifest)).toThrow(/unrecognized|unexpected|invalid/i);
  });
});
