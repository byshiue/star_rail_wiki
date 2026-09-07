import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildOfflineWiki } from "../build";
import { verifyOfflineWiki } from "../verify";
import { renderPdfWithPlaywright, renderTrustedPdfHtmlWithPlaywrightForTest } from "./render";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "__fixtures__", "releases");
const loreRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "__fixtures__", "lore");

function emptyLoreFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "offline-wiki-empty-lore-"));
  const releaseRoot = join(root, "4.4-fixture");
  cpSync(join(loreRoot, "4.4-fixture"), releaseRoot, { recursive: true });
  for (const filename of ["divergent-universe.json", "worldview.json", "missions.json", "collectibles.json"]) {
    writeFileSync(join(releaseRoot, filename), "[]\n");
  }
  return root;
}

const fakePdf = async ({ title }: { title: string }) => ({
  bytes: new TextEncoder().encode(`%PDF-1.7\n/Type /Page\n${title}\n%%EOF\n`),
  pageCount: 1,
});

describe("offline wiki PDF build", () => {
  it("writes the fixture's grouped PDFs and a checksummed build manifest", async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "offline-wiki-pdf-"));

    const manifest = await buildOfflineWiki({
      releasesRoot: fixtureRoot,
      editorialRoot: join(repositoryRoot, "data", "offline-wiki"),
      releaseId: "4.4-fixture",
      outputRoot,
      loreRoot,
      renderPdf: async ({ title }) => ({
        bytes: new TextEncoder().encode(`%PDF-1.7\n/Type /Page\n${title}\n%%EOF\n`),
        pageCount: 1,
      }),
    });

    expect(manifest.outputs.map((output) => output.filename)).toEqual([
      "00-总索引.pdf",
      "01-角色图鉴.pdf",
      "02-光锥图鉴.pdf",
      "03-遗器图鉴.pdf",
      "04-差分宇宙-索引.pdf",
      "04-差分宇宙-方程-001.pdf",
      "05-世界观-索引.pdf",
      "05-世界观-地点-001.pdf",
      "06-剧情-索引.pdf",
      "06-剧情-开拓任务-001.pdf",
      "07-文本收藏-索引.pdf",
      "07-文本收藏-书籍与读物-001.pdf",
    ]);
    expect(manifest.schemaVersion).toBe(2);
    expect(manifest.outputs.map(({ family, group, order }) => ({ family, group, order }))).toEqual([
      { family: null, group: "global-index", order: 0 },
      { family: null, group: "characters", order: 1 },
      { family: null, group: "light-cones", order: 2 },
      { family: null, group: "relic-sets", order: 3 },
      { family: "divergent-universe", group: "index", order: 4 },
      { family: "divergent-universe", group: "equation", order: 5 },
      { family: "worldview", group: "index", order: 6 },
      { family: "worldview", group: "location", order: 7 },
      { family: "mission", group: "index", order: 8 },
      { family: "mission", group: "trailblaze", order: 9 },
      { family: "collectible", group: "index", order: 10 },
      { family: "collectible", group: "readable", order: 11 },
    ]);
    expect(manifest.outputs.every((output) => output.checksum.startsWith("sha256:"))).toBe(true);
    expect(manifest.outputs.every((output) => output.pageCount === 1)).toBe(true);
    expect(manifest.outputs.every((output) => existsSync(join(outputRoot, "builds", "4.4-fixture", "pdf", output.filename))))
      .toBe(true);
    expect(JSON.parse(readFileSync(join(outputRoot, "builds", "4.4-fixture", "build-manifest.json"), "utf8")))
      .toEqual(manifest);
  });

  it("does not request an escaped remote image string from local full text", async () => {
    await expect(renderPdfWithPlaywright({
      html: '<!doctype html><p>&lt;img src=&quot;https://blocked.invalid/escaped.png&quot;&gt;</p>',
      title: "escaped local text",
    })).resolves.toMatchObject({ pageCount: 1 });
  });

  it("reports the blocked URL when low-level raw HTML attempts a remote request", async () => {
    await expect(renderTrustedPdfHtmlWithPlaywrightForTest({
      html: '<!doctype html><img src="https://blocked.invalid/raw.png">',
      title: "unsafe raw hook",
    })).rejects.toThrow(/https:\/\/blocked\.invalid\/raw\.png/);
  });

  it("reports a print-only blocked URL after the media phase", async () => {
    await expect(renderTrustedPdfHtmlWithPlaywrightForTest({
      html: '<!doctype html><style>@media print { body { background-image: url("https://blocked.invalid/print.png") } }</style>',
      title: "unsafe print hook",
    })).rejects.toThrow(/https:\/\/blocked\.invalid\/print\.png/);
  });

  it.each([
    ["file:///tmp/offline-wiki-secret.png"],
    ["data:text/html,<p>nested</p>"],
  ])("rejects non-allowlisted embedded resource %s", async (url) => {
    await expect(renderPdfWithPlaywright({
      html: `<!doctype html><iframe src="${url}"></iframe>`,
      title: "unsafe embedded resource",
    })).rejects.toThrow(/forbidden|allowed|data image/i);
  });

  it("atomically replaces stale subgroup files when a same-release rebuild has fewer volumes", async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "offline-wiki-rebuild-"));
    await buildOfflineWiki({
      releasesRoot: fixtureRoot, editorialRoot: join(repositoryRoot, "data", "offline-wiki"),
      releaseId: "4.4-fixture", outputRoot, loreRoot, renderPdf: fakePdf,
    });
    await buildOfflineWiki({
      releasesRoot: fixtureRoot, editorialRoot: join(repositoryRoot, "data", "offline-wiki"),
      releaseId: "4.4-fixture", outputRoot, loreRoot: emptyLoreFixture(), renderPdf: fakePdf,
    });

    const buildRoot = join(outputRoot, "builds", "4.4-fixture");
    expect(readdirSync(join(buildRoot, "html")).filter((name) => name.endsWith(".html"))).toHaveLength(8);
    expect(readdirSync(join(buildRoot, "pdf")).filter((name) => name.endsWith(".pdf"))).toHaveLength(8);
    expect(verifyOfflineWiki({ outputRoot, releaseId: "4.4-fixture" }).verifiedFiles).toBe(8);
  });

  it("preserves the prior verified build when a staged rebuild fails", async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "offline-wiki-rebuild-"));
    await buildOfflineWiki({
      releasesRoot: fixtureRoot, editorialRoot: join(repositoryRoot, "data", "offline-wiki"),
      releaseId: "4.4-fixture", outputRoot, loreRoot, renderPdf: fakePdf,
    });
    const buildRoot = join(outputRoot, "builds", "4.4-fixture");
    const oldManifest = readFileSync(join(buildRoot, "build-manifest.json"), "utf8");
    const oldIndex = readFileSync(join(buildRoot, "html", "00-总索引.html"), "utf8");

    await expect(buildOfflineWiki({
      releasesRoot: fixtureRoot, editorialRoot: join(repositoryRoot, "data", "offline-wiki"),
      releaseId: "4.4-fixture", outputRoot, loreRoot: emptyLoreFixture(),
      renderPdf: async () => { throw new Error("fixture render failed"); },
    })).rejects.toThrow(/fixture render failed/);

    expect(readFileSync(join(buildRoot, "build-manifest.json"), "utf8")).toBe(oldManifest);
    expect(readFileSync(join(buildRoot, "html", "00-总索引.html"), "utf8")).toBe(oldIndex);
    expect(verifyOfflineWiki({ outputRoot, releaseId: "4.4-fixture" }).verifiedFiles).toBe(12);
  });
});
