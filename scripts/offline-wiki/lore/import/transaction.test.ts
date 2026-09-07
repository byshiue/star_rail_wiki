import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
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
});
