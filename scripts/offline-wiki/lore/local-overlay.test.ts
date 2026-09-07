import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
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

function writeOverlayAt(path: string, records: unknown[]): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
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

  it("rejects prefix-collision filenames instead of using substring containment", () => {
    const root = mkdtempSync(join(tmpdir(), "offline-wiki-prefix-"));
    const path = join(root, ".local", "offline-wiki", "imports", "4.4-fixture", "normalized", "current.jsonl.backup");
    writeOverlayAt(path, [overlayRecord()]);
    expect(() => loadLocalFullTextOverlay(path, "4.4-fixture", committed)).toThrow(/exact|current\.jsonl|path/i);
  });

  it("rejects a symlinked parent even when both lexical and real paths contain the expected suffix", () => {
    const root = mkdtempSync(join(tmpdir(), "offline-wiki-parent-link-"));
    const targetLocal = join(root, "target", ".local");
    const targetPath = join(targetLocal, "offline-wiki", "imports", "4.4-fixture", "normalized", "current.jsonl");
    writeOverlayAt(targetPath, [overlayRecord()]);
    mkdirSync(join(root, "lexical"), { recursive: true });
    symlinkSync(targetLocal, join(root, "lexical", ".local"));
    const lexicalPath = join(root, "lexical", ".local", "offline-wiki", "imports", "4.4-fixture", "normalized", "current.jsonl");
    expect(() => loadLocalFullTextOverlay(lexicalPath, "4.4-fixture", committed)).toThrow(/symlink|canonical|path/i);
  });

  it("rejects a broken final symlink instead of treating it as an absent optional overlay", () => {
    const root = mkdtempSync(join(tmpdir(), "offline-wiki-broken-link-"));
    const path = join(root, ".local", "offline-wiki", "imports", "4.4-fixture", "normalized", "current.jsonl");
    mkdirSync(join(path, ".."), { recursive: true });
    symlinkSync(join(root, "missing.jsonl"), path);
    expect(() => loadLocalFullTextOverlay(path, "4.4-fixture", committed)).toThrow(/symlink|regular|path/i);
  });

  it("detects replacement of the opened file before admitting its bytes", () => {
    const path = writeOverlay([overlayRecord()]);
    expect(() => loadLocalFullTextOverlay(path, "4.4-fixture", committed, {
      operations: { afterOpen: () => {
        renameSync(path, `${path}.old`);
        writeOverlayAt(path, [overlayRecord()]);
      } },
    })).toThrow(/changed|identity|stable/i);
  });

  it("detects a parent-directory swap even when the reopened path is the same file inode", () => {
    const path = writeOverlay([overlayRecord()]);
    const parent = join(path, "..");
    const oldParent = `${parent}.old`;
    expect(() => loadLocalFullTextOverlay(path, "4.4-fixture", committed, {
      operations: { afterRead: () => {
        renameSync(parent, oldParent);
        mkdirSync(parent);
        renameSync(join(oldParent, "current.jsonl"), path);
      } },
    })).toThrow(/parent.*changed|identity/i);
  });

  it("rejects files over 16 MiB before parsing", () => {
    const oversized = overlayRecord({
      sections: [{ order: 0, title: null, speaker: null, branch: null, body: "大".repeat(6 * 1024 * 1024) }],
    });
    const path = writeOverlay([oversized]);
    expect(() => loadLocalFullTextOverlay(path, "4.4-fixture", committed)).toThrow(/16 MiB|size|large/i);
  });

  it("rejects malformed UTF-8 instead of accepting replacement characters", () => {
    const valid = Buffer.from(`${JSON.stringify(overlayRecord({
      sections: [{ order: 0, title: null, speaker: null, branch: null, body: "替换�字符" }],
    }))}\n`);
    const replacement = Buffer.from("�");
    const index = valid.indexOf(replacement);
    expect(index).toBeGreaterThanOrEqual(0);
    const malformed = Buffer.concat([valid.subarray(0, index), Buffer.from([0xff]), valid.subarray(index + replacement.length)]);
    const path = writeOverlay([]);
    writeFileSync(path, malformed);
    expect(() => loadLocalFullTextOverlay(path, "4.4-fixture", committed)).toThrow(/UTF-8|encoding/i);
  });
});
