import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { importLocalLore } from "./transaction";

function checksum(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function canonicalRecord(logicalId = "lore:worldview:faction:1") {
  return {
    logicalId,
    family: "worldview",
    kind: "faction",
    name: "测试派系",
    releaseId: "4.4-fixture",
    locale: "zh-CN",
    sourceRevision: "fixture-revision",
    sections: [{ order: 1, title: null, speaker: null, branch: null, body: "本地正文。" }],
  };
}

function fixture(lines: string[]) {
  const repositoryRoot = mkdtempSync(join(tmpdir(), "offline-wiki-repository-"));
  const sourceRoot = mkdtempSync(join(tmpdir(), "offline-wiki-source-"));
  const hydrated = lines.map((line) => line === "VALID"
    ? JSON.stringify(canonicalRecord())
    : line);
  const text = `${hydrated.join("\n")}\n`;
  const inputPath = join(sourceRoot, "worldview.jsonl");
  writeFileSync(inputPath, text);
  const manifestChecksum = checksum(text);
  const manifest = {
    schemaVersion: 1,
    releaseId: "4.4-fixture",
    locale: "zh-CN",
    source: { name: "Fixture", revision: "fixture-revision", exportedAt: "2026-09-06T00:00:00.000Z" },
    adapter: "canonical-jsonl",
    adapterVersion: 1,
    families: ["worldview"],
    userProvided: true,
    files: [{ path: "worldview.jsonl", bytes: Buffer.byteLength(text), checksum: manifestChecksum }],
  };
  const manifestPath = join(sourceRoot, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest));
  return { repositoryRoot, sourceRoot, manifestPath, manifest, text };
}

describe("importLocalLore", () => {
  it("preserves the current overlay byte-for-byte when a later input line is invalid", () => {
    const data = fixture(["VALID", "{bad json}"]);
    const normalizedRoot = join(data.repositoryRoot, ".local/offline-wiki/imports/4.4-fixture/normalized");
    mkdirSync(normalizedRoot, { recursive: true });
    const currentPath = join(normalizedRoot, "current.jsonl");
    const original = Buffer.from("previous bytes\r\n", "utf8");
    writeFileSync(currentPath, original);

    const report = importLocalLore({
      repositoryRoot: data.repositoryRoot,
      releaseId: "4.4-fixture",
      manifestPath: data.manifestPath,
      sourceRoot: data.sourceRoot,
    });

    expect(report.status).toBe("rejected");
    expect(readFileSync(currentPath)).toEqual(original);
    expect(JSON.stringify(report)).not.toContain("本地正文");
    expect(report).toMatchObject({ acceptedCount: 0, rejectedCount: 1 });
  });

  it("atomically replaces a valid overlay and reports accepted checksums", () => {
    const data = fixture(["VALID"]);
    const report = importLocalLore({
      repositoryRoot: data.repositoryRoot,
      releaseId: "4.4-fixture",
      manifestPath: data.manifestPath,
      sourceRoot: data.sourceRoot,
    });
    const currentPath = join(data.repositoryRoot, ".local/offline-wiki/imports/4.4-fixture/normalized/current.jsonl");
    const current = readFileSync(currentPath, "utf8");

    expect(report).toMatchObject({ status: "accepted", acceptedCount: 1, rejectedCount: 0 });
    expect(report.inputChecksums).toEqual([data.manifest.files[0].checksum]);
    expect(report.outputChecksum).toBe(checksum(current));
    expect(current.endsWith("\n")).toBe(true);
  });

  it("rejects output roots that resolve outside the repository local lore boundary", () => {
    const data = fixture(["VALID"]);
    expect(() => importLocalLore({
      repositoryRoot: data.repositoryRoot,
      releaseId: "4.4-fixture",
      manifestPath: data.manifestPath,
      sourceRoot: data.sourceRoot,
      outputRoot: join(data.repositoryRoot, "outside"),
    })).toThrow(/\.local\/offline-wiki|outside|boundary/i);
  });

  it("rejects a symlinked local lore directory instead of writing through it", () => {
    const data = fixture(["VALID"]);
    const outside = mkdtempSync(join(tmpdir(), "offline-wiki-output-outside-"));
    mkdirSync(join(data.repositoryRoot, ".local"));
    symlinkSync(outside, join(data.repositoryRoot, ".local/offline-wiki"));

    expect(() => importLocalLore({
      repositoryRoot: data.repositoryRoot,
      releaseId: "4.4-fixture",
      manifestPath: data.manifestPath,
      sourceRoot: data.sourceRoot,
    })).toThrow(/symlink|canonical|boundary/i);
    expect(existsSync(join(outside, "imports"))).toBe(false);
  });

  it("rejects a source replaced after its manifest was written and preserves current bytes", () => {
    const data = fixture(["VALID"]);
    const normalizedRoot = join(data.repositoryRoot, ".local/offline-wiki/imports/4.4-fixture/normalized");
    mkdirSync(normalizedRoot, { recursive: true });
    const currentPath = join(normalizedRoot, "current.jsonl");
    writeFileSync(currentPath, "last-good\n");
    unlinkSync(join(data.sourceRoot, "worldview.jsonl"));
    writeFileSync(join(data.sourceRoot, "worldview.jsonl"), "replacement\n");
    const report = importLocalLore({ repositoryRoot: data.repositoryRoot, releaseId: "4.4-fixture", manifestPath: data.manifestPath, sourceRoot: data.sourceRoot });
    expect(report.status).toBe("rejected");
    expect(report.rejection?.reason).toMatch(/^(?:manifest|source)-validation-failed$/);
    expect(readFileSync(currentPath, "utf8")).toBe("last-good\n");
  });

  it.each([
    ["symlink", (path: string) => { const outside = mkdtempSync(join(tmpdir(), "lore-swap-")); writeFileSync(join(outside, "x"), "x"); unlinkSync(path); symlinkSync(join(outside, "x"), path); }],
    ["invalid UTF-8", (path: string) => writeFileSync(path, Buffer.from([0xc3, 0x28]))],
    ["oversized replacement", (path: string) => writeFileSync(path, Buffer.alloc(16 * 1024 * 1024 + 1))],
  ])("preserves current when source becomes %s", (_label, mutate) => {
    const data = fixture(["VALID"]); const target = join(data.repositoryRoot, ".local/offline-wiki/imports/4.4-fixture/normalized");
    mkdirSync(target, { recursive: true }); writeFileSync(join(target, "current.jsonl"), "last-good\n");
    mutate(join(data.sourceRoot, "worldview.jsonl"));
    const report = importLocalLore({ repositoryRoot: data.repositoryRoot, releaseId: "4.4-fixture", manifestPath: data.manifestPath, sourceRoot: data.sourceRoot });
    expect(report.status).toBe("rejected"); expect(readFileSync(join(target, "current.jsonl"), "utf8")).toBe("last-good\n");
  });

  it("restores a verified last-good backup when a crash journal exists and target is missing", () => {
    const good = fixture(["VALID"]);
    importLocalLore({ repositoryRoot: good.repositoryRoot, releaseId: "4.4-fixture", manifestPath: good.manifestPath, sourceRoot: good.sourceRoot });
    const releaseRoot = join(good.repositoryRoot, ".local/offline-wiki/imports/4.4-fixture");
    const target = join(releaseRoot, "normalized");
    const backupName = ".normalized-backup-test1234";
    renameSync(target, join(releaseRoot, backupName));
    writeFileSync(join(releaseRoot, ".normalized-transaction.json"), JSON.stringify({ schemaVersion: 1, phase: "backed-up", targetName: "normalized", stagingName: ".normalized-staging-test1234", backupName, expectedOutputChecksum: `sha256:${"b".repeat(64)}` }));
    writeFileSync(join(releaseRoot, ".normalized-transaction.lock"), JSON.stringify({ pid: 2147483647, nonce: "stale-lock" }));
    writeFileSync(join(good.sourceRoot, "worldview.jsonl"), "{bad}\n");

    const report = importLocalLore({ repositoryRoot: good.repositoryRoot, releaseId: "4.4-fixture", manifestPath: good.manifestPath, sourceRoot: good.sourceRoot });
    expect(report.status).toBe("rejected");
    expect(existsSync(target)).toBe(true);
    expect(existsSync(join(releaseRoot, backupName))).toBe(false);
  });

  it("treats a verified promoted target as committed when backup cleanup fails", () => {
    const data = fixture(["VALID"]);
    const first = importLocalLore({ repositoryRoot: data.repositoryRoot, releaseId: "4.4-fixture", manifestPath: data.manifestPath, sourceRoot: data.sourceRoot });
    const releaseRoot = join(data.repositoryRoot, ".local/offline-wiki/imports/4.4-fixture");
    const target = join(releaseRoot, "normalized");
    const backupName = ".normalized-backup-test5678";
    cpSync(target, join(releaseRoot, backupName), { recursive: true });
    writeFileSync(join(releaseRoot, ".normalized-transaction.json"), JSON.stringify({ schemaVersion: 1, phase: "promoted", targetName: "normalized", stagingName: ".normalized-staging-test5678", backupName, expectedOutputChecksum: first.outputChecksum }));

    const report = importLocalLore({
      repositoryRoot: data.repositoryRoot,
      releaseId: "4.4-fixture",
      manifestPath: data.manifestPath,
      sourceRoot: data.sourceRoot,
      operations: { removeBackup: () => { throw new Error("fixture cleanup failure"); } },
    });
    expect(report.status).toBe("accepted");
    expect(report.warnings).toContain("backup-cleanup-pending");
    expect(existsSync(target)).toBe(true);
    expect(existsSync(join(releaseRoot, backupName))).toBe(true);
  });

  it("fails closed on malformed recovery state without overwriting a last-good backup", () => {
    const data = fixture(["VALID"]);
    const releaseRoot = join(data.repositoryRoot, ".local/offline-wiki/imports/4.4-fixture");
    mkdirSync(join(releaseRoot, ".normalized-backup-manual"), { recursive: true });
    writeFileSync(join(releaseRoot, ".normalized-backup-manual/current.jsonl"), "last-good\n");
    writeFileSync(join(releaseRoot, ".normalized-transaction.json"), "{bad}");
    const report = importLocalLore({ repositoryRoot: data.repositoryRoot, releaseId: "4.4-fixture", manifestPath: data.manifestPath, sourceRoot: data.sourceRoot });
    expect(report.status).toBe("rejected");
    expect(report.rejection?.reason).toBe("recovery-failed");
    expect(existsSync(join(releaseRoot, ".normalized-backup-manual/current.jsonl"))).toBe(true);
    expect(existsSync(join(releaseRoot, "normalized"))).toBe(false);
  });

  it("retains the unique backup and journal when a competing target blocks rollback", () => {
    const data = fixture(["VALID"]);
    importLocalLore({ repositoryRoot: data.repositoryRoot, releaseId: "4.4-fixture", manifestPath: data.manifestPath, sourceRoot: data.sourceRoot });
    const releaseRoot = join(data.repositoryRoot, ".local/offline-wiki/imports/4.4-fixture");
    const report = importLocalLore({ repositoryRoot: data.repositoryRoot, releaseId: "4.4-fixture", manifestPath: data.manifestPath, sourceRoot: data.sourceRoot, operations: {
      beforePromote: (target) => { mkdirSync(target); writeFileSync(join(target, "competitor"), "do-not-delete"); throw new Error("stop"); },
    } });
    expect(report.status).toBe("rejected");
    expect(readFileSync(join(releaseRoot, "normalized/competitor"), "utf8")).toBe("do-not-delete");
    const backups = readdirSync(releaseRoot).filter((name) => name.startsWith(".normalized-backup-"));
    expect(backups).toHaveLength(1);
    expect(report.rejection?.recoveryNames).toEqual(expect.arrayContaining([JOURNAL_NAME_FOR_TEST, backups[0]]));
  });
});

const JOURNAL_NAME_FOR_TEST = ".normalized-transaction.json";
