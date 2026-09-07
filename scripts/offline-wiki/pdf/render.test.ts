import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildOfflineWiki } from "../build";
import { renderPdfWithPlaywright } from "./render";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "__fixtures__", "releases");
const loreRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "__fixtures__", "lore");

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
        bytes: new TextEncoder().encode(`%PDF-1.7\n${title}\n%%EOF\n`),
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
    await expect(renderPdfWithPlaywright({
      html: '<!doctype html><img src="https://blocked.invalid/raw.png">',
      title: "unsafe raw hook",
    })).rejects.toThrow(/https:\/\/blocked\.invalid\/raw\.png/);
  });

  it.each([
    ["file:///tmp/offline-wiki-secret.png"],
    ["data:text/html,<p>nested</p>"],
  ])("rejects non-allowlisted embedded resource %s", async (url) => {
    await expect(renderPdfWithPlaywright({
      html: `<!doctype html><iframe src="${url}"></iframe>`,
      title: "unsafe embedded resource",
    })).rejects.toThrow(url);
  });
});
