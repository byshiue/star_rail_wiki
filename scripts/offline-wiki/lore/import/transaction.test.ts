import { createHash } from "node:crypto";
import { closeSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
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

function fixture(lines: string[], logicalId = "lore:worldview:faction:1") {
  const repositoryRoot = mkdtempSync(join(tmpdir(), "offline-wiki-repository-"));
  const sourceRoot = mkdtempSync(join(tmpdir(), "offline-wiki-source-"));
  const hydrated = lines.map((line) => line === "VALID"
    ? JSON.stringify(canonicalRecord(logicalId))
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

function savedHoyoWikiFixture(options: { invalidHtml?: boolean } = {}) {
  const repositoryRoot = mkdtempSync(join(tmpdir(), "offline-wiki-repository-"));
  const sourceRoot = mkdtempSync(join(tmpdir(), "offline-wiki-hoyowiki-source-"));
  mkdirSync(join(sourceRoot, "entries"));
  const sources = {
    "aggregate-list.json": JSON.stringify({ releaseId: "4.4-fixture", locale: "zh-CN", entries: [{ id: "1001", category: "阵营", name: "测试派系" }] }),
    "category-mapping.json": JSON.stringify({ categories: { "阵营": { family: "worldview", kind: "faction" } }, entries: { "1001": { logicalId: "lore:worldview:faction:1001", sourcePath: "entries/1001.html" } } }),
    "entries/1001.html": options.invalidHtml ? "<script>private body</script>" : "<h2>背景</h2><p>离线正文。</p>",
  };
  for (const [path, text] of Object.entries(sources)) writeFileSync(join(sourceRoot, path), text);
  const manifest = {
    schemaVersion: 1, releaseId: "4.4-fixture", locale: "zh-CN",
    source: { name: "Fixture", revision: "fixture-revision", exportedAt: "2026-09-06T00:00:00.000Z" },
    adapter: "saved-hoyowiki", adapterVersion: 1, families: ["worldview"], userProvided: true,
    files: Object.entries(sources).map(([path, text]) => ({ path, bytes: Buffer.byteLength(text), checksum: checksum(text) })),
  };
  const manifestPath = join(sourceRoot, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest));
  return { repositoryRoot, sourceRoot, manifestPath };
}

describe("importLocalLore", () => {
  it("dispatches a saved HoYoWiki manifest and binds the entry source checksum", () => {
    const data = savedHoyoWikiFixture();
    const report = importLocalLore({ ...data, releaseId: "4.4-fixture" });
    expect(report).toMatchObject({ status: "accepted", acceptedCount: 1, rejectedCount: 0 });
    const current = readFileSync(join(data.repositoryRoot, ".local/offline-wiki/imports/4.4-fixture/normalized/current.jsonl"), "utf8");
    const record = JSON.parse(current.trim());
    expect(record).toMatchObject({ logicalId: "lore:worldview:faction:1001", sourcePath: "entries/1001.html" });
    expect(record.sourceChecksum).toBe(checksum("<h2>背景</h2><p>离线正文。</p>"));
    expect(record.sourceDependencies).toEqual([
      { path: "aggregate-list.json", checksum: report.inputChecksums[0] },
      { path: "category-mapping.json", checksum: report.inputChecksums[1] },
      { path: "entries/1001.html", checksum: report.inputChecksums[2] },
    ]);
  });

  it("rejects the whole adapter batch, preserves the last-good overlay, and emits only safe rejection metadata", () => {
    const data = savedHoyoWikiFixture({ invalidHtml: true });
    const target = join(data.repositoryRoot, ".local/offline-wiki/imports/4.4-fixture/normalized");
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "current.jsonl"), "last-good\n");
    const report = importLocalLore({ ...data, releaseId: "4.4-fixture" });
    expect(report).toMatchObject({ status: "rejected", acceptedCount: 0, rejectedCount: 1, rejection: {
      reason: "adapter-rejected",
      items: [{ sourcePath: "entries/1001.html", logicalId: "lore:worldview:faction:1001", reason: "missing-text", detail: "no-allowlisted-text" }],
    } });
    expect(readFileSync(join(target, "current.jsonl"), "utf8")).toBe("last-good\n");
    expect(JSON.stringify(report)).not.toContain("private body");
  });

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
    writeFileSync(join(releaseRoot, ".normalized-transaction.json"), JSON.stringify({ schemaVersion: 1, phase: "backed-up", targetName: "normalized", stagingName: ".normalized-staging-test1234", backupName, priorOutputChecksum: firstOutputChecksum(join(releaseRoot, backupName)), expectedOutputChecksum: `sha256:${"b".repeat(64)}` }));
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
    writeFileSync(join(releaseRoot, ".normalized-transaction.json"), JSON.stringify({ schemaVersion: 1, phase: "promoted", targetName: "normalized", stagingName: ".normalized-staging-test5678", backupName, priorOutputChecksum: first.outputChecksum, expectedOutputChecksum: first.outputChecksum }));

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

  it("recovers prepared crashes from the prior-target identity matrix", () => {
    const old = fixture(["VALID"], "lore:worldview:faction:old");
    const prior = importLocalLore({ repositoryRoot: old.repositoryRoot, releaseId: "4.4-fixture", manifestPath: old.manifestPath, sourceRoot: old.sourceRoot });
    const newer = fixture(["VALID"], "lore:worldview:faction:new");
    const expected = importLocalLore({ repositoryRoot: newer.repositoryRoot, releaseId: "4.4-fixture", manifestPath: newer.manifestPath, sourceRoot: newer.sourceRoot });
    const releaseRoot = join(old.repositoryRoot, ".local/offline-wiki/imports/4.4-fixture");
    const target = join(releaseRoot, "normalized"); const stagingName = ".normalized-staging-matrix1"; const backupName = ".normalized-backup-matrix1";
    cpSync(join(newer.repositoryRoot, ".local/offline-wiki/imports/4.4-fixture/normalized"), join(releaseRoot, stagingName), { recursive: true });
    renameSync(target, join(releaseRoot, backupName));
    writeJournal(releaseRoot, { phase: "prepared", stagingName, backupName, priorOutputChecksum: prior.outputChecksum, expectedOutputChecksum: expected.outputChecksum });
    writeFileSync(join(old.sourceRoot, "worldview.jsonl"), "{bad}\n");
    const report = importLocalLore({ repositoryRoot: old.repositoryRoot, releaseId: "4.4-fixture", manifestPath: old.manifestPath, sourceRoot: old.sourceRoot });
    expect(report.status).toBe("rejected"); expect(firstOutputChecksum(target)).toBe(prior.outputChecksum);
    expect(existsSync(join(releaseRoot, stagingName))).toBe(false); expect(existsSync(join(releaseRoot, JOURNAL_NAME_FOR_TEST))).toBe(false);
  });

  it("recognizes a no-prior prepared crash after staging was promoted as committed", () => {
    const data = fixture(["VALID"]); const committed = importLocalLore({ repositoryRoot: data.repositoryRoot, releaseId: "4.4-fixture", manifestPath: data.manifestPath, sourceRoot: data.sourceRoot });
    const releaseRoot = join(data.repositoryRoot, ".local/offline-wiki/imports/4.4-fixture");
    writeJournal(releaseRoot, { phase: "prepared", stagingName: ".normalized-staging-gone", backupName: null, priorOutputChecksum: null, expectedOutputChecksum: committed.outputChecksum });
    const recovered = importLocalLore({ repositoryRoot: data.repositoryRoot, releaseId: "4.4-fixture", manifestPath: data.manifestPath, sourceRoot: data.sourceRoot });
    expect(recovered.status).toBe("accepted"); expect(recovered.outputChecksum).toBe(committed.outputChecksum);
  });

  it("recognizes committed state after backup cleanup but before journal removal", () => {
    const data = fixture(["VALID"]); const committed = importLocalLore({ repositoryRoot: data.repositoryRoot, releaseId: "4.4-fixture", manifestPath: data.manifestPath, sourceRoot: data.sourceRoot });
    const releaseRoot = join(data.repositoryRoot, ".local/offline-wiki/imports/4.4-fixture");
    writeJournal(releaseRoot, { phase: "promoted", stagingName: ".normalized-staging-gone", backupName: ".normalized-backup-already-cleaned", priorOutputChecksum: committed.outputChecksum, expectedOutputChecksum: committed.outputChecksum });
    const recovered = importLocalLore({ repositoryRoot: data.repositoryRoot, releaseId: "4.4-fixture", manifestPath: data.manifestPath, sourceRoot: data.sourceRoot });
    expect(recovered.status).toBe("accepted"); expect(existsSync(join(releaseRoot, JOURNAL_NAME_FOR_TEST))).toBe(false);
    expect(importLocalLore({ repositoryRoot: data.repositoryRoot, releaseId: "4.4-fixture", manifestPath: data.manifestPath, sourceRoot: data.sourceRoot }).status).toBe("accepted");
  });

  it("fails closed and preserves every artifact for an ambiguous prepared state", () => {
    const data = fixture(["VALID"]); const prior = importLocalLore({ repositoryRoot: data.repositoryRoot, releaseId: "4.4-fixture", manifestPath: data.manifestPath, sourceRoot: data.sourceRoot });
    const releaseRoot = join(data.repositoryRoot, ".local/offline-wiki/imports/4.4-fixture"); const target = join(releaseRoot, "normalized");
    const backupName = ".normalized-backup-ambiguous"; const stagingName = ".normalized-staging-ambiguous";
    cpSync(target, join(releaseRoot, backupName), { recursive: true }); cpSync(target, join(releaseRoot, stagingName), { recursive: true });
    writeJournal(releaseRoot, { phase: "prepared", stagingName, backupName, priorOutputChecksum: prior.outputChecksum, expectedOutputChecksum: prior.outputChecksum });
    const report = importLocalLore({ repositoryRoot: data.repositoryRoot, releaseId: "4.4-fixture", manifestPath: data.manifestPath, sourceRoot: data.sourceRoot });
    expect(report.status).toBe("rejected"); expect(report.rejection?.reason).toBe("recovery-failed");
    expect(existsSync(target)).toBe(true); expect(existsSync(join(releaseRoot, backupName))).toBe(true); expect(existsSync(join(releaseRoot, stagingName))).toBe(true);
  });

  it("aborts an unmutated prepared transaction when prior target and staged candidate both verify", () => {
    const data = fixture(["VALID"]); const prior = importLocalLore({ repositoryRoot: data.repositoryRoot, releaseId: "4.4-fixture", manifestPath: data.manifestPath, sourceRoot: data.sourceRoot });
    const releaseRoot = join(data.repositoryRoot, ".local/offline-wiki/imports/4.4-fixture"); const stagingName = ".normalized-staging-abort";
    cpSync(join(releaseRoot, "normalized"), join(releaseRoot, stagingName), { recursive: true });
    writeJournal(releaseRoot, { phase: "prepared", stagingName, backupName: ".normalized-backup-not-created", priorOutputChecksum: prior.outputChecksum, expectedOutputChecksum: prior.outputChecksum });
    writeFileSync(join(data.sourceRoot, "worldview.jsonl"), "{bad}\n");
    const report = importLocalLore({ repositoryRoot: data.repositoryRoot, releaseId: "4.4-fixture", manifestPath: data.manifestPath, sourceRoot: data.sourceRoot });
    expect(report.status).toBe("rejected"); expect(existsSync(join(releaseRoot, stagingName))).toBe(false); expect(firstOutputChecksum(join(releaseRoot, "normalized"))).toBe(prior.outputChecksum);
  });

  it("serializes stale-lock reclaimers so a nested contender cannot enter", () => {
    const data = fixture(["VALID"]); const releaseRoot = join(data.repositoryRoot, ".local/offline-wiki/imports/4.4-fixture"); mkdirSync(releaseRoot, { recursive: true });
    writeFileSync(join(releaseRoot, ".normalized-transaction.lock"), JSON.stringify({ pid: 2147483647, nonce: "old" }));
    let nested: ReturnType<typeof importLocalLore> | undefined;
    const outer = importLocalLore({ repositoryRoot: data.repositoryRoot, releaseId: "4.4-fixture", manifestPath: data.manifestPath, sourceRoot: data.sourceRoot, operations: {
      duringLockReclaim: () => { nested = importLocalLore({ repositoryRoot: data.repositoryRoot, releaseId: "4.4-fixture", manifestPath: data.manifestPath, sourceRoot: data.sourceRoot }); },
    } });
    expect(outer.status).toBe("accepted"); expect(nested?.status).toBe("rejected");
  });

  it("cleans only its own atomic-json temp after rename failure", () => {
    const data = fixture(["VALID"]); const releaseRoot = join(data.repositoryRoot, ".local/offline-wiki/imports/4.4-fixture"); mkdirSync(releaseRoot, { recursive: true });
    writeFileSync(join(releaseRoot, "other.tmp"), "keep");
    const report = importLocalLore({ repositoryRoot: data.repositoryRoot, releaseId: "4.4-fixture", manifestPath: data.manifestPath, sourceRoot: data.sourceRoot, operations: { beforeAtomicRename: () => { throw new Error("rename failure"); } } });
    expect(report.status).toBe("rejected"); expect(readFileSync(join(releaseRoot, "other.tmp"), "utf8")).toBe("keep");
    expect(readdirSync(releaseRoot).filter((name) => name.endsWith(".tmp"))).toEqual(["other.tmp"]);
  });

  it("preserves a valid competing target discovered after the prior snapshot", () => {
    const data = fixture(["VALID"], "lore:worldview:faction:prior"); importLocalLore({ repositoryRoot: data.repositoryRoot, releaseId: "4.4-fixture", manifestPath: data.manifestPath, sourceRoot: data.sourceRoot });
    const competitor = fixture(["VALID"], "lore:worldview:faction:competitor"); importLocalLore({ repositoryRoot: competitor.repositoryRoot, releaseId: "4.4-fixture", manifestPath: competitor.manifestPath, sourceRoot: competitor.sourceRoot });
    const releaseRoot = join(data.repositoryRoot, ".local/offline-wiki/imports/4.4-fixture"); const target = join(releaseRoot, "normalized"); const competitorTarget = join(competitor.repositoryRoot, ".local/offline-wiki/imports/4.4-fixture/normalized"); const competingChecksum = firstOutputChecksum(competitorTarget);
    const report = importLocalLore({ repositoryRoot: data.repositoryRoot, releaseId: "4.4-fixture", manifestPath: data.manifestPath, sourceRoot: data.sourceRoot, operations: { beforeBackupRename: () => { rmSync(target, { recursive: true }); cpSync(competitorTarget, target, { recursive: true }); } } });
    expect(report.status).toBe("rejected"); expect(firstOutputChecksum(target)).toBe(competingChecksum); expect(existsSync(join(releaseRoot, JOURNAL_NAME_FOR_TEST))).toBe(true); expect(readdirSync(releaseRoot).some((name) => name.startsWith(".normalized-staging-"))).toBe(true);
  });

  it("closes the reclaim guard fd when inspection aborts", () => {
    const data = fixture(["VALID"]); const releaseRoot = join(data.repositoryRoot, ".local/offline-wiki/imports/4.4-fixture"); mkdirSync(releaseRoot, { recursive: true }); writeFileSync(join(releaseRoot, ".normalized-transaction.lock"), JSON.stringify({ pid: 2147483647, nonce: "old" }));
    let descriptor = -1;
    const report = importLocalLore({ repositoryRoot: data.repositoryRoot, releaseId: "4.4-fixture", manifestPath: data.manifestPath, sourceRoot: data.sourceRoot, operations: { inspectReclaimGuardFd: (fd) => { descriptor = fd; throw new Error("inspection failure"); } } });
    expect(report.status).toBe("rejected"); expect(descriptor).toBeGreaterThanOrEqual(0); expect(() => closeSync(descriptor)).toThrow(/bad file descriptor|EBADF/i);
  });
});

const JOURNAL_NAME_FOR_TEST = ".normalized-transaction.json";
function firstOutputChecksum(root: string): string { return JSON.parse(readFileSync(join(root, "report.json"), "utf8")).outputChecksum as string; }
function writeJournal(root: string, fields: { phase: string; stagingName: string; backupName: string | null; priorOutputChecksum: string | null; expectedOutputChecksum: string | null }): void {
  writeFileSync(join(root, JOURNAL_NAME_FOR_TEST), JSON.stringify({ schemaVersion: 1, targetName: "normalized", ...fields }));
}
