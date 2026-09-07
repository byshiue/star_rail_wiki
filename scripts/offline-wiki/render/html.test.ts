import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadDocumentCatalog } from "../catalog";
import type { StorySummary } from "../schema";
import { renderVolumes } from "./volumes";

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "__fixtures__", "releases");
const loreRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "__fixtures__", "lore");

describe("offline wiki HTML volumes", () => {
  it("keeps the existing character and equipment volumes unchanged", () => {
    const catalog = loadDocumentCatalog(fixtureRoot, "4.4-fixture");
    const volumes = renderVolumes({ catalog, summaries: [] });

    expect(volumes.map((volume) => volume.filename)).toEqual([
      "00-总索引.html",
      "01-角色图鉴.html",
      "02-光锥图鉴.html",
      "03-遗器图鉴.html",
    ]);
    expect(volumes[1]?.html).toContain("@page { size: A4");
    expect(volumes[1]?.html).toContain("测试角色");
    expect(volumes[1]?.html).toContain("造成100%攻击力的伤害。");
    expect(volumes[1]?.html).toContain("4.4-fixture");
    expect(volumes[1]?.html).toContain("abcdef12");
  });

  it("escapes source-derived text instead of emitting executable markup", () => {
    const catalog = loadDocumentCatalog(fixtureRoot, "4.4-fixture");
    catalog.characters[0]!.description = "<script>alert('source')</script>";

    const characterVolume = renderVolumes({ catalog, summaries: [] })[1]!.html;

    expect(characterVolume).toContain("&lt;script&gt;alert(&#39;source&#39;)&lt;/script&gt;");
    expect(characterVolume).not.toContain("<script>alert('source')</script>");
  });

  it("embeds a locally cached image and its attribution instead of a placeholder", () => {
    const catalog = loadDocumentCatalog(fixtureRoot, "4.4-fixture");

    const characterVolume = renderVolumes({
      catalog,
      summaries: [],
      assets: [{
        logicalId: "character:1",
        dataUrl: "data:image/png;base64,AQID",
        attribution: "Official artwork",
      }],
    })[1]!.html;

    expect(characterVolume).toContain('src="data:image/png;base64,AQID"');
    expect(characterVolume).toContain("Official artwork");
    expect(characterVolume).not.toContain("角色图片未缓存");
  });

  it("lists release additions and changes in the global index", () => {
    const catalog = loadDocumentCatalog(fixtureRoot, "4.4-fixture");
    const indexVolume = renderVolumes({
      catalog,
      summaries: [],
      changes: {
        baselineReleaseId: "4.3-fixture",
        added: ["character:1"],
        changed: ["light-cone:1"],
        unchanged: ["relic-set:1"],
        removed: [],
      },
    })[0]!.html;

    expect(indexVolume).toContain("相对 4.3-fixture");
    expect(indexVolume).toContain("新增（1）");
    expect(indexVolume).toContain("character:1");
    expect(indexVolume).toContain("变更（1）");
    expect(indexVolume).toContain("light-cone:1");
  });

  it("links every entity in the global index to its volume destination", () => {
    const catalog = loadDocumentCatalog(fixtureRoot, "4.4-fixture");
    const indexVolume = renderVolumes({ catalog, summaries: [] })[0]!.html;

    expect(indexVolume).toContain('href="01-角色图鉴.pdf#entry-character-1"');
    expect(indexVolume).toContain('href="02-光锥图鉴.pdf#entry-light-cone-1"');
    expect(indexVolume).toContain('href="03-遗器图鉴.pdf#entry-relic-set-1"');
  });

  it("labels Agent-written story summaries as not human-reviewed", () => {
    const catalog = loadDocumentCatalog(fixtureRoot, "4.4-fixture");
    const summaries: StorySummary[] = [{
      logicalId: "character:1",
      entityKind: "character",
      releaseId: "4.4-fixture",
      locale: "zh-CN",
      summary: "这是一段自动生成的原创故事摘要。",
      contentChecksum: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      reviewStatus: "auto-generated",
      generator: { name: "Codex", generatedAt: "2026-09-07T03:00:00.000Z" },
      provenance: [{
        sourceName: "Official public wiki",
        sourceUrl: "https://wiki.hoyolab.com/pc/hsr/entry/1",
        sourceRevision: "2026-09-07",
        sourcePath: "entry/1",
        sourceChecksum: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      }],
    }];

    const volumes = renderVolumes({ catalog, summaries });

    expect(volumes[1]?.html).toContain("自动生成 · 未经人工复核 · Codex");
    expect(volumes[1]?.html).not.toContain("Codex 审核");
  });

  it("describes reviewed, generated, and user-local story layers honestly", () => {
    const catalog = loadDocumentCatalog(fixtureRoot, "4.4-fixture");

    const volumes = renderVolumes({ catalog, summaries: [] });

    expect(volumes[0]?.html).toContain("经审核原创摘要、自动生成且未经人工复核的原创摘要，以及仅存在于本机的用户导入全文");
    expect(volumes[0]?.html).not.toContain("故事部分为经审核的原创摘要");
  });

  it("reports global lore coverage and rejections without a percentage when any baseline is missing", () => {
    const catalog = loadDocumentCatalog(fixtureRoot, "4.4-fixture", undefined, { loreRoot });

    const index = renderVolumes({ catalog, summaries: [] })[0]!.html;

    expect(index).toContain("基准缺失；结构化 4；本地全文 0；拒绝 0");
    expect(index).not.toMatch(/背景资料：[^<]*覆盖率[^<]*%/);
  });
});
