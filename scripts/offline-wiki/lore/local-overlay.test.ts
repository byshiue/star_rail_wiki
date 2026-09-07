import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadLoreCatalog } from "./catalog";
import { loadLocalFullTextOverlay } from "./local-overlay";

const loreRoot = join(import.meta.dirname, "..", "__fixtures__", "lore");
const sha = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;

function overlayRecord(overrides: Record<string, unknown> = {}) {
  const fields = {
    schemaVersion: 2 as const,
    logicalId: "lore:worldview:location:belobog",
    family: "worldview",
    kind: "location",
    name: "贝洛伯格",
    releaseId: "4.4-fixture",
    locale: "zh-CN",
    sourceRevision: "fixture-revision",
    sourcePath: "entry/1",
    sourceChecksum: `sha256:${"a".repeat(64)}`,
    sourceDependencies: [{ path: "entry/1", checksum: `sha256:${"a".repeat(64)}` }],
    sections: [{ order: 0, title: null, speaker: null, branch: null, body: "本地测试正文。" }],
    inputChecksum: `sha256:${"b".repeat(64)}`,
    importedAt: "2026-09-06T00:00:00.000Z",
    adapterVersion: 1,
    ...overrides,
  };
  return { ...fields, contentChecksum: sha(JSON.stringify(fields)) };
}

function writeOverlay(records: unknown[]): string {
  const root = mkdtempSync(join(tmpdir(), "offline-wiki-overlay-"));
  const path = join(root, ".local", "offline-wiki", "imports", "4.4-fixture", "normalized", "current.jsonl");
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
  return path;
}

describe("loadLocalFullTextOverlay", () => {
  const committed = loadLoreCatalog(loreRoot, "4.4-fixture").records;

  it("returns an empty map when the optional path is absent or missing", () => {
    expect(loadLocalFullTextOverlay(undefined, "4.4-fixture", committed).size).toBe(0);
    expect(loadLocalFullTextOverlay(join(tmpdir(), "missing-lore-overlay.jsonl"), "4.4-fixture", committed).size).toBe(0);
  });

  it("admits a strict normalized record only when its committed source identity matches", () => {
    const overlay = loadLocalFullTextOverlay(writeOverlay([overlayRecord()]), "4.4-fixture", committed);
    expect(overlay.get("lore:worldview:location:belobog")?.sections[0]?.body).toBe("本地测试正文。");
  });

  it.each([
    ["unknown logical ID", { logicalId: "lore:worldview:location:unknown" }, /unknown|committed/i],
    ["later release", { releaseId: "4.5-cn-2026-09-01" }, /release/i],
    ["locale drift", { locale: "en-US" }, /locale|invalid/i],
    ["revision drift", { sourceRevision: "other-revision" }, /revision|provenance/i],
    ["checksum drift", { sourceChecksum: `sha256:${"c".repeat(64)}`, sourceDependencies: [{ path: "entry/1", checksum: `sha256:${"c".repeat(64)}` }] }, /checksum|provenance/i],
  ])("rejects %s", (_label, overrides, error) => {
    expect(() => loadLocalFullTextOverlay(writeOverlay([overlayRecord(overrides)]), "4.4-fixture", committed)).toThrow(error);
  });

  it("fails closed on duplicate IDs, mixed versions, and invalid normalized checksums", () => {
    const v2 = overlayRecord();
    const { schemaVersion: _version, sourceDependencies: _dependencies, contentChecksum: _checksum, ...legacyFields } = v2;
    const legacy = { ...legacyFields, contentChecksum: sha(JSON.stringify(legacyFields)) };
    expect(() => loadLocalFullTextOverlay(writeOverlay([v2, v2]), "4.4-fixture", committed)).toThrow(/duplicate/i);
    expect(() => loadLocalFullTextOverlay(writeOverlay([v2, legacy]), "4.4-fixture", committed)).toThrow(/mixed|version/i);
    expect(() => loadLocalFullTextOverlay(writeOverlay([{ ...v2, name: "漂移" }]), "4.4-fixture", committed)).toThrow(/checksum/i);
  });

  it("refuses to load an existing full-text file from a Git data path", () => {
    const root = mkdtempSync(join(tmpdir(), "offline-wiki-git-data-"));
    const path = join(root, "data", "offline-wiki", "full-text-overlay.jsonl");
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, `${JSON.stringify(overlayRecord())}\n`);
    expect(() => loadLocalFullTextOverlay(path, "4.4-fixture", committed)).toThrow(/local|import|tracked|Git/i);
  });
});
