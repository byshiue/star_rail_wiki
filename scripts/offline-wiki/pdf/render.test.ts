import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildOfflineWiki } from "../build";

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
    expect(manifest.outputs.every((output) => output.checksum.startsWith("sha256:"))).toBe(true);
    expect(manifest.outputs.every((output) => output.pageCount === 1)).toBe(true);
    expect(manifest.outputs.every((output) => existsSync(join(outputRoot, "builds", "4.4-fixture", "pdf", output.filename))))
      .toBe(true);
    expect(JSON.parse(readFileSync(join(outputRoot, "builds", "4.4-fixture", "build-manifest.json"), "utf8")))
      .toEqual(manifest);
  });
});
