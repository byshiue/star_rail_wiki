import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildHtmlVolumes } from "./build-html";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "releases");
const loreRoot = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "lore");
function overlayText(): string {
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
  };
  const contentChecksum = `sha256:${createHash("sha256").update(JSON.stringify(fields)).digest("hex")}`;
  return `${JSON.stringify({ ...fields, contentChecksum })}\n`;
}


  it("binds one verified overlay snapshot to coverage and rendered full text", () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "offline-wiki-html-"));
    const overlayRepository = mkdtempSync(join(tmpdir(), "offline-wiki-overlay-repository-"));
    const normalizedRoot = join(overlayRepository, ".local", "offline-wiki", "imports", "4.4-fixture", "normalized");
    const localOverlayPath = join(normalizedRoot, "current.jsonl");
    mkdirSync(normalizedRoot, { recursive: true });
    writeFileSync(localOverlayPath, overlayText());

    let snapshotBound = false;
    buildHtmlVolumes({
      releasesRoot: fixtureRoot,
      editorialRoot: join(repositoryRoot, "data", "offline-wiki"),
      releaseId: "4.4-fixture",
      outputRoot,
      loreRoot,
      localOverlayPath,
      operations: {
        afterCatalogLoaded: () => {
          const replacement = `${localOverlayPath}.replacement`;
          writeFileSync(replacement, "");
          snapshotBound = true;
          renameSync(replacement, localOverlayPath);
        },
      },
    });

    expect(snapshotBound).toBe(true);
    const familyIndex = readFileSync(join(outputRoot, "previews", "4.4-fixture", "html", "05-世界观-索引.html"), "utf8");
    const volume = readFileSync(join(outputRoot, "previews", "4.4-fixture", "html", "05-世界观-地点-001.html"), "utf8");
    expect(familyIndex).toContain("本地全文：1");
    expect(volume).toContain("本地测试正文");
  });

  it("exactly replaces standalone HTML previews so obsolete dynamic volumes disappear", () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "offline-wiki-html-"));
    const options = {
      releasesRoot: fixtureRoot,
      editorialRoot: join(repositoryRoot, "data", "offline-wiki"),
      releaseId: "4.4-fixture",
      outputRoot,
      loreRoot,
    };
    buildHtmlVolumes(options);
    const htmlRoot = join(outputRoot, "previews", "4.4-fixture", "html");
    writeFileSync(join(htmlRoot, "04-差分宇宙-已废弃-999.html"), "obsolete");

    const outputs = buildHtmlVolumes(options);

    expect(readdirSync(htmlRoot).sort()).toEqual(outputs.map(({ filename }) => filename).sort());
  });

describe("offline wiki HTML build", () => {
  it("writes existing and grouped lore volumes beneath the requested local output root", () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "offline-wiki-html-"));

    const outputs = buildHtmlVolumes({
      releasesRoot: fixtureRoot,
      editorialRoot: join(repositoryRoot, "data", "offline-wiki"),
      releaseId: "4.4-fixture",
      outputRoot,
      loreRoot,
    });

    expect(outputs.map(({ filename }) => filename)).toEqual([
      "00-总索引.html",
      "01-角色图鉴.html",
      "02-光锥图鉴.html",
      "03-遗器图鉴.html",
      "04-差分宇宙-索引.html",
      "04-差分宇宙-方程-001.html",
      "05-世界观-索引.html",
      "05-世界观-地点-001.html",
      "06-剧情-索引.html",
      "06-剧情-开拓任务-001.html",
      "07-文本收藏-索引.html",
      "07-文本收藏-书籍与读物-001.html",
    ]);
    expect(readFileSync(join(outputRoot, "previews", "4.4-fixture", "html", "01-角色图鉴.html"), "utf8"))
      .toContain("测试角色");
  });

  it("loads available manifest-listed artwork from the local release cache", () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "offline-wiki-html-"));
    const cacheRoot = mkdtempSync(join(tmpdir(), "offline-wiki-html-assets-"));
    const assetManifestPath = join(outputRoot, "assets.json");
    writeFileSync(join(cacheRoot, "character-1.png"), new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    writeFileSync(assetManifestPath, JSON.stringify([{
      logicalId: "character:1",
      role: "character-splash",
      url: "https://assets.example/character-1.png",
      allowedHost: "assets.example",
      mediaType: "image/png",
      checksum: null,
      attribution: "Official artwork",
      cacheKey: "character-1",
    }]));

    buildHtmlVolumes({
      releasesRoot: fixtureRoot,
      editorialRoot: join(repositoryRoot, "data", "offline-wiki"),
      releaseId: "4.4-fixture",
      outputRoot,
      assetManifestPath,
      assetCacheRoot: cacheRoot,
      loreRoot,
    });

    expect(readFileSync(join(outputRoot, "previews", "4.4-fixture", "html", "01-角色图鉴.html"), "utf8"))
      .toContain('src="data:image/png;base64,iVBORw0KGgo="');
  });

  it("loads the fixed last-rejected report next to the selected local overlay by default", () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "offline-wiki-html-"));
    const importRoot = join(outputRoot, ".local", "offline-wiki", "imports", "4.4-fixture");
    const localOverlayPath = join(importRoot, "normalized", "current.jsonl");
    mkdirSync(join(importRoot, "reports"), { recursive: true });
    writeFileSync(join(importRoot, "reports", "last-rejected.json"), JSON.stringify({
      status: "rejected", releaseId: "4.4-fixture", acceptedCount: 0, rejectedCount: 1,
      inputChecksums: [], outputChecksum: null, warnings: [], rejection: {
        reason: "adapter-rejected", sourcePaths: [], recoveryNames: [], items: [{
          sourcePath: "unknown.json", logicalId: null, reason: "unknown-kind", detail: "category-not-mapped",
        }],
      },
    }));

    buildHtmlVolumes({
      releasesRoot: fixtureRoot,
      editorialRoot: join(repositoryRoot, "data", "offline-wiki"),
      releaseId: "4.4-fixture",
      outputRoot,
      loreRoot,
      localOverlayPath,
    });

    const index = readFileSync(join(outputRoot, "previews", "4.4-fixture", "html", "00-总索引.html"), "utf8");
    expect(index).toContain("未归属拒绝：未知类别 1");
  });
});
