import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildHtmlVolumes } from "./build-html";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "releases");
const loreRoot = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "lore");

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
