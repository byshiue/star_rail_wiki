import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadDocumentCatalog } from "../catalog";
import type { LocalFullTextOverlayRecord } from "../lore/local-overlay";
import type { LoreRecord, StorySummary } from "../schema";
import { renderLoreVolumes } from "./lore-volumes";

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "__fixtures__", "releases");
const loreRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "__fixtures__", "lore");

function fixtureCatalog() {
  return loadDocumentCatalog(fixtureRoot, "4.4-fixture", undefined, { loreRoot });
}

function loreSummary(logicalId: string, summary: string): StorySummary {
  return {
    logicalId,
    entityKind: "lore",
    releaseId: "4.4-fixture",
    locale: "zh-CN",
    summary,
    contentChecksum: `sha256:${"a".repeat(64)}`,
    reviewStatus: "reviewed",
    reviewer: { name: "审核者", reviewedAt: "2026-09-06T01:00:00.000Z" },
    provenance: [{
      sourceName: "<来源>",
      sourceUrl: "https://wiki.hoyolab.com/pc/hsr/entry/1",
      sourceRevision: "fixture-revision",
      sourcePath: "entry/1",
      sourceChecksum: `sha256:${"a".repeat(64)}`,
    }],
  };
}

describe("offline wiki lore volumes", () => {
  it("renders fixed family indexes and allowlisted subgroup filenames", () => {
    const volumes = renderLoreVolumes({ catalog: fixtureCatalog(), summaries: [], localOverlay: new Map() });

    expect(volumes.filter(({ filename }) => filename.endsWith("索引.html")).map(({ filename }) => filename)).toEqual([
      "04-差分宇宙-索引.html",
      "05-世界观-索引.html",
      "06-剧情-索引.html",
      "07-文本收藏-索引.html",
    ]);
    expect(volumes.map(({ filename }) => filename)).toEqual(expect.arrayContaining([
      "04-差分宇宙-方程-001.html",
      "05-世界观-地点-001.html",
      "06-剧情-开拓任务-001.html",
      "07-文本收藏-书籍与读物-001.html",
    ]));
    expect(volumes.every(({ filename }) => !filename.includes("沉默的星"))).toBe(true);
  });

  it("uses taxonomy order, then Chinese name and logical ID, and splits every 200 entries", () => {
    const catalog = fixtureCatalog();
    const equation = catalog.lore.find((record) => record.kind === "equation")!;
    const equations = Array.from({ length: 201 }, (_, index): LoreRecord => ({
      ...equation,
      logicalId: `lore:du:equation:${String(index).padStart(3, "0")}`,
      name: "同名条目",
    }));
    catalog.lore = [...equations, ...catalog.lore.filter((record) => record.family !== "divergent-universe")];

    const volumes = renderLoreVolumes({ catalog, summaries: [], localOverlay: new Map() });
    const equationVolumes = volumes.filter(({ filename }) => filename.startsWith("04-差分宇宙-方程-"));

    expect(equationVolumes.map(({ filename }) => filename)).toEqual([
      "04-差分宇宙-方程-001.html",
      "04-差分宇宙-方程-002.html",
    ]);
    expect(equationVolumes[0]!.html.indexOf("lore:du:equation:000"))
      .toBeLessThan(equationVolumes[0]!.html.indexOf("lore:du:equation:001"));
    const familyIndex = volumes.find(({ filename }) => filename === "04-差分宇宙-索引.html")!.html;
    expect(familyIndex.indexOf("方程")).toBeLessThan(familyIndex.indexOf("奇物"));

    catalog.lore = [
      { ...equation, logicalId: "lore:du:equation:z", name: "乙" },
      { ...equation, logicalId: "lore:du:equation:b", name: "甲" },
      { ...equation, logicalId: "lore:du:equation:a", name: "甲" },
      ...catalog.lore.filter((record) => record.family !== "divergent-universe"),
    ];
    const sortedHtml = renderLoreVolumes({ catalog, summaries: [], localOverlay: new Map() })
      .find(({ filename }) => filename === "04-差分宇宙-方程-001.html")!.html;
    expect(sortedHtml.indexOf("lore:du:equation:a")).toBeLessThan(sortedHtml.indexOf("lore:du:equation:b"));
    expect(sortedHtml.indexOf("lore:du:equation:b")).toBeLessThan(sortedHtml.indexOf("lore:du:equation:z"));
  });

  it("links only prevalidated internal relationships to anchors that are rendered", () => {
    const catalog = fixtureCatalog();
    const mission = catalog.lore.find((record) => record.family === "mission")!;
    mission.relationships.push({ type: "features", targetLogicalId: "character:1", external: false });

    const volumes = renderLoreVolumes({ catalog, summaries: [], localOverlay: new Map() });
    const missionHtml = volumes.find(({ filename }) => filename === "06-剧情-开拓任务-001.html")!.html;
    const worldviewHtml = volumes.find(({ filename }) => filename === "05-世界观-地点-001.html")!.html;

    expect(missionHtml).toContain('href="05-世界观-地点-001.html#entry-lore-worldview-location-belobog">贝洛伯格</a>');
    expect(missionHtml).toContain('href="01-角色图鉴.html#entry-character-1">测试角色</a>');
    expect(worldviewHtml).toContain('id="entry-lore-worldview-location-belobog"');
  });

  it("renders escaped summaries and an honest missing-full-text fallback", () => {
    const logicalId = "lore:mission:trailblaze:silent-star";
    const volumes = renderLoreVolumes({
      catalog: fixtureCatalog(),
      summaries: [loreSummary(logicalId, "原创 <摘要> & 内容")],
      localOverlay: new Map(),
    });
    const html = volumes.find(({ filename }) => filename === "06-剧情-开拓任务-001.html")!.html;

    expect(html).toContain("原创 &lt;摘要&gt; &amp; 内容");
    expect(html).toContain("原创摘要 · 审核者 审核");
    expect(html).toContain("本地全文未导入");
    expect(html).not.toContain("原创 <摘要>");
  });

  it("renders ordered and escaped user-local full-text sections with a local-only notice", () => {
    const catalog = fixtureCatalog();
    const record = catalog.lore.find((candidate) => candidate.family === "mission")!;
    const overlay: LocalFullTextOverlayRecord = {
      logicalId: record.logicalId,
      family: record.family,
      kind: record.kind,
      name: "<本地标题>",
      releaseId: record.releaseId,
      locale: record.locale,
      sourceRevision: "fixture-revision",
      sourcePath: "entry/1",
      sourceChecksum: `sha256:${"a".repeat(64)}`,
      sections: [
        { order: 2, title: "后章<script>", speaker: "乙&", branch: "分支>二", body: "后文 <img src=x>" },
        { order: 1, title: "前章", speaker: "甲<", branch: "分支&一", body: "前文\n第二行" },
      ],
      inputChecksum: `sha256:${"b".repeat(64)}`,
      contentChecksum: `sha256:${"c".repeat(64)}`,
      importedAt: "2026-09-06T01:00:00.000Z",
      adapterVersion: 1,
    };

    const volumes = renderLoreVolumes({ catalog, summaries: [], localOverlay: new Map([[record.logicalId, overlay]]) });
    const html = volumes.find(({ filename }) => filename === "06-剧情-开拓任务-001.html")!.html;

    expect(html).toContain("全文来自用户提供的本地资料；未上传 GitHub");
    expect(html.indexOf("前章")).toBeLessThan(html.indexOf("后章&lt;script&gt;"));
    expect(html).toContain("甲&lt;");
    expect(html).toContain("分支&amp;一");
    expect(html).toContain("前文<br>第二行");
    expect(html).toContain("后文 &lt;img src=x&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x>");
  });

  it("shows structured/full-text/rejections and omits a percentage for a missing baseline", () => {
    const volumes = renderLoreVolumes({ catalog: fixtureCatalog(), summaries: [], localOverlay: new Map() });
    const missionIndex = volumes.find(({ filename }) => filename === "06-剧情-索引.html")!.html;

    expect(missionIndex).toContain("基准缺失");
    expect(missionIndex).toContain("结构化：1");
    expect(missionIndex).toContain("本地全文：0");
    expect(missionIndex).toContain("拒绝：0");
    expect(missionIndex).not.toMatch(/覆盖率[^<]*%/);
  });

  it("escapes every record and relationship label instead of trusting catalog text", () => {
    const catalog = fixtureCatalog();
    const mission = catalog.lore.find((record) => record.family === "mission")!;
    const location = catalog.lore.find((record) => record.kind === "location")!;
    mission.name = "<任务>";
    mission.description = "描述 <script>alert(1)</script>";
    location.name = "<地点&>";

    const html = renderLoreVolumes({ catalog, summaries: [], localOverlay: new Map() })
      .find(({ filename }) => filename === "06-剧情-开拓任务-001.html")!.html;

    expect(html).toContain("&lt;任务&gt;");
    expect(html).toContain("描述 &lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&lt;地点&amp;&gt;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });
});
