import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { LocalLoreManifest } from "../manifest";
import { materializeCanonicalLoreInput } from "../canonical";
import { convertSavedHoyoWiki } from "./hoyowiki";

const checksum = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;

function fixture(overrides: { aggregate?: unknown; mapping?: unknown; html?: string } = {}) {
  const sourceRoot = mkdtempSync(join(tmpdir(), "hoyowiki-adapter-"));
  const aggregate = JSON.stringify(overrides.aggregate ?? {
    releaseId: "4.4-fixture", locale: "zh-CN",
    entries: [{ id: "1001", category: "阵营", name: "测试派系" }, { id: "9999", category: "阵营", name: "未声明项目" }],
  });
  const mapping = JSON.stringify(overrides.mapping ?? {
    categories: { "阵营": { family: "worldview", kind: "faction" } },
    entries: { "1001": { logicalId: "lore:worldview:faction:1001", sourcePath: "entries/1001.html" } },
  });
  const html = overrides.html ?? "<h2>背景</h2><p>短篇原创正文。</p><script>bad()</script>";
  const files = [
    ["aggregate-list.json", aggregate],
    ["category-mapping.json", mapping],
    ["entries/1001.html", html],
  ] as const;
  for (const [path, text] of files) {
    const absolute = join(sourceRoot, path);
    if (path.includes("/")) mkdirSync(join(sourceRoot, "entries"), { recursive: true });
    writeFileSync(absolute, text);
  }
  const manifest: LocalLoreManifest = {
    schemaVersion: 1, releaseId: "4.4-fixture", locale: "zh-CN",
    source: { name: "Local fixture", revision: "fixture-revision", exportedAt: "2026-09-06T00:00:00.000Z" },
    adapter: "saved-hoyowiki", adapterVersion: 1, families: ["worldview"], userProvided: true,
    files: files.map(([path, text]) => ({ path, bytes: Buffer.byteLength(text), checksum: checksum(text) })),
  };
  return { sourceRoot, manifest };
}

describe("convertSavedHoyoWiki", () => {
  it("maps only explicitly declared IDs through the explicit category mapping", () => {
    const { sourceRoot, manifest } = fixture();
    const result = convertSavedHoyoWiki({ manifest, sourceRoot });
    expect(result.entries).toEqual([{
      sourcePath: "entries/1001.html",
      dependencyPaths: ["aggregate-list.json", "category-mapping.json", "entries/1001.html"],
      input: {
        logicalId: "lore:worldview:faction:1001", family: "worldview", kind: "faction", name: "测试派系",
        releaseId: "4.4-fixture", locale: "zh-CN", sourceRevision: "fixture-revision",
        sections: [{ order: 0, title: "背景", speaker: null, branch: null, body: "短篇原创正文。" }],
      },
    }]);
    expect(result.rejections).toEqual([{ sourcePath: "aggregate-list.json", logicalId: null, reason: "malformed-source", detail: "entry-not-declared" }]);
  });

  it("rejects duplicate aggregate entry IDs before lookup", () => {
    const duplicate = { id: "1001", category: "阵营", name: "测试派系" };
    const { sourceRoot, manifest } = fixture({ aggregate: { releaseId: "4.4-fixture", locale: "zh-CN", entries: [duplicate, duplicate] } });
    expect(convertSavedHoyoWiki({ manifest, sourceRoot })).toMatchObject({ entries: [], rejections: [{ reason: "malformed-source", detail: "duplicate-entry-id" }] });
  });

  it("rejects categories without an explicit approved family/kind mapping", () => {
    const { sourceRoot, manifest } = fixture({ aggregate: { releaseId: "4.4-fixture", locale: "zh-CN", entries: [{ id: "1001", category: "未知", name: "项目" }] } });
    expect(convertSavedHoyoWiki({ manifest, sourceRoot })).toMatchObject({ entries: [], rejections: [{ reason: "unknown-kind", detail: "category-not-mapped" }] });
  });

  it.each(["latest", "4.5-cn-2026-09-01", undefined])("rejects ambiguous or out-of-scope release evidence %s", (releaseId) => {
    const { sourceRoot, manifest } = fixture({ aggregate: { releaseId, locale: "zh-CN", entries: [{ id: "1001", category: "阵营", name: "项目" }] } });
    expect(convertSavedHoyoWiki({ manifest, sourceRoot })).toMatchObject({ entries: [], rejections: [{ reason: "ambiguous-release", detail: "release-evidence-mismatch" }] });
  });

  it("rejects unsafe HTML with no allowed body without retaining source text", () => {
    const { sourceRoot, manifest } = fixture({
      aggregate: { releaseId: "4.4-fixture", locale: "zh-CN", entries: [{ id: "1001", category: "阵营", name: "测试派系" }] },
      html: "<script>private long body</script><img src='https://bad.invalid/x'>",
    });
    const result = convertSavedHoyoWiki({ manifest, sourceRoot });
    expect(result.entries).toEqual([]);
    expect(result.rejections).toEqual([{ sourcePath: "entries/1001.html", logicalId: "lore:worldview:faction:1001", reason: "missing-text", detail: "no-allowlisted-text" }]);
    expect(JSON.stringify(result.rejections)).not.toContain("private long body");
  });

  it("normalizes JSON-provided display names to safe plain text", () => {
    const { sourceRoot, manifest } = fixture({
      aggregate: { releaseId: "4.4-fixture", locale: "zh-CN", entries: [{ id: "1001", category: "阵营", name: "测试 <tag> https://bad.invalid/name" }] },
    });
    const result = convertSavedHoyoWiki({ manifest, sourceRoot });
    expect(result.entries[0].input.name).toBe("测试 tag");
    expect(JSON.stringify(result.entries)).not.toMatch(/<|>|https?:\/\//i);
  });

  it("changes record provenance and content checksum when only the mapping bytes change", () => {
    const { sourceRoot, manifest } = fixture({ aggregate: { releaseId: "4.4-fixture", locale: "zh-CN", entries: [{ id: "1001", category: "阵营", name: "测试派系" }] } });
    const firstEntry = convertSavedHoyoWiki({ manifest, sourceRoot }).entries[0];
    const first = materializeCanonicalLoreInput(firstEntry.input, manifest, firstEntry.sourcePath, firstEntry.dependencyPaths);
    const mappingPath = join(sourceRoot, "category-mapping.json");
    const mapping = JSON.parse(readFileSync(mappingPath, "utf8"));
    const changedText = JSON.stringify(mapping, null, 2);
    writeFileSync(mappingPath, changedText);
    manifest.files[1] = { ...manifest.files[1], bytes: Buffer.byteLength(changedText), checksum: checksum(changedText) };
    const secondEntry = convertSavedHoyoWiki({ manifest, sourceRoot }).entries[0];
    const second = materializeCanonicalLoreInput(secondEntry.input, manifest, secondEntry.sourcePath, secondEntry.dependencyPaths);
    expect(second.sourceDependencies[1].checksum).not.toBe(first.sourceDependencies[1].checksum);
    expect(second.contentChecksum).not.toBe(first.contentChecksum);
  });
});
