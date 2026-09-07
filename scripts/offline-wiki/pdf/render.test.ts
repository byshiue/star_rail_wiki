import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { describe, expect, it } from "vitest";
import { buildOfflineWiki } from "../build";
import { verifyOfflineWiki } from "../verify";
import { installNetworkBlocker, renderPdfWithPlaywright } from "./render";

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

  it.each([
    ["raw", '<!doctype html><img src="https://blocked.invalid/raw.png">', "https://blocked.invalid/raw.png"],
    ["print", '<!doctype html><style>@media print { body { background-image: url("https://blocked.invalid/print.png") } }</style>', "https://blocked.invalid/print.png"],
  ])("the production network blocker aborts and records a %s HTTP request", async (_phase, html, expectedUrl) => {
    const browser = await chromium.launch({ headless: true });
    try {
      const context = await browser.newContext({ javaScriptEnabled: false });
      const blockedUrls: string[] = [];
      await installNetworkBlocker(context, blockedUrls);
      const page = await context.newPage();
      await page.setContent(html, { waitUntil: "load" });
      await page.emulateMedia({ media: "print" });
      await page.waitForTimeout(50);
      expect(blockedUrls).toContain(expectedUrl);
    } finally {
      await browser.close();
    }
  });

  it("the public renderer cannot bypass static validation with raw HTTP HTML", async () => {
    await expect(renderPdfWithPlaywright({
      html: '<!doctype html><img src="https://blocked.invalid/raw.png">',
      title: "unsafe raw HTML",
    })).rejects.toThrow(/data image|forbidden/i);
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

  it.each(["output-root", "builds", "dangling-builds"])("rejects a %s symlink without writing outside", async (mode) => {
    const container = mkdtempSync(join(tmpdir(), "offline-wiki-path-"));
    const outside = mkdtempSync(join(tmpdir(), "offline-wiki-outside-"));
    const outputRoot = join(container, "output");
    if (mode === "output-root") {
      symlinkSync(outside, outputRoot, "dir");
    } else {
      mkdirSync(outputRoot);
      symlinkSync(mode === "builds" ? outside : join(container, "missing"), join(outputRoot, "builds"), "dir");
    }

    await expect(buildOfflineWiki({
      releasesRoot: fixtureRoot, editorialRoot: join(repositoryRoot, "data", "offline-wiki"),
      releaseId: "4.4-fixture", outputRoot, loreRoot, renderPdf: fakePdf,
    })).rejects.toThrow(/symlink|canonical/i);
    expect(readdirSync(outside)).toEqual([]);
  });

  it("commits a verified build with a persistent cleanup warning and clears it on retry", async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "offline-wiki-cleanup-"));
    await buildOfflineWiki({
      releasesRoot: fixtureRoot, editorialRoot: join(repositoryRoot, "data", "offline-wiki"),
      releaseId: "4.4-fixture", outputRoot, loreRoot, renderPdf: fakePdf,
    });
    const warned = await buildOfflineWiki({
      releasesRoot: fixtureRoot, editorialRoot: join(repositoryRoot, "data", "offline-wiki"),
      releaseId: "4.4-fixture", outputRoot, loreRoot: emptyLoreFixture(), renderPdf: fakePdf,
      fileOperationsForTest: { removeBackup: () => { throw new Error("cleanup denied"); } },
    });

    expect(warned.warnings).toEqual(["backup-cleanup-pending"]);
    expect(JSON.parse(readFileSync(join(outputRoot, "builds", "4.4-fixture", "build-manifest.json"), "utf8")).warnings)
      .toEqual(["backup-cleanup-pending"]);
    expect(JSON.parse(readFileSync(
      join(outputRoot, "builds", ".4.4-fixture.build-transaction.json"),
      "utf8",
    )).phase).toBe("cleanup-pending");
    expect(verifyOfflineWiki({ outputRoot, releaseId: "4.4-fixture" }).verifiedFiles).toBe(8);
    expect(readdirSync(join(outputRoot, "builds")).filter((name) => name.includes(".backup-"))).toHaveLength(1);

    const retried = await buildOfflineWiki({
      releasesRoot: fixtureRoot, editorialRoot: join(repositoryRoot, "data", "offline-wiki"),
      releaseId: "4.4-fixture", outputRoot, loreRoot: emptyLoreFixture(), renderPdf: fakePdf,
    });
    expect(retried.warnings).toEqual([]);
    expect(readdirSync(join(outputRoot, "builds")).filter((name) => name.includes(".backup-"))).toEqual([]);
  });

  it("fails closed without deleting ambiguous pending backups", async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "offline-wiki-cleanup-"));
    await buildOfflineWiki({
      releasesRoot: fixtureRoot, editorialRoot: join(repositoryRoot, "data", "offline-wiki"),
      releaseId: "4.4-fixture", outputRoot, loreRoot, renderPdf: fakePdf,
    });
    const buildsRoot = join(outputRoot, "builds");
    mkdirSync(join(buildsRoot, "4.4-fixture.backup-first"));
    mkdirSync(join(buildsRoot, "4.4-fixture.backup-second"));

    await expect(buildOfflineWiki({
      releasesRoot: fixtureRoot, editorialRoot: join(repositoryRoot, "data", "offline-wiki"),
      releaseId: "4.4-fixture", outputRoot, loreRoot, renderPdf: fakePdf,
    })).rejects.toThrow(/ambiguous.*backup/i);
    expect(readdirSync(buildsRoot).filter((name) => name.includes(".backup-"))).toHaveLength(2);
    expect(verifyOfflineWiki({ outputRoot, releaseId: "4.4-fixture" }).verifiedFiles).toBe(12);
  });
  it("restores the verified prior build after crashing between backup rename and backed-up journal", async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "offline-wiki-crash-"));
    await buildOfflineWiki({ releasesRoot: fixtureRoot, editorialRoot: join(repositoryRoot, "data", "offline-wiki"), releaseId: "4.4-fixture", outputRoot, loreRoot, renderPdf: fakePdf });
    await expect(buildOfflineWiki({ releasesRoot: fixtureRoot, editorialRoot: join(repositoryRoot, "data", "offline-wiki"), releaseId: "4.4-fixture", outputRoot, loreRoot: emptyLoreFixture(), renderPdf: fakePdf,
      fileOperationsForTest: { afterBackupRename: () => { throw new Error("simulated crash"); } },
    })).rejects.toThrow(/simulated crash/);
    await expect(buildOfflineWiki({ releasesRoot: fixtureRoot, editorialRoot: join(repositoryRoot, "data", "offline-wiki"), releaseId: "4.4-fixture", outputRoot, loreRoot, renderPdf: async () => { throw new Error("stop after recovery"); } })).rejects.toThrow(/stop after recovery/);
    expect(verifyOfflineWiki({ outputRoot, releaseId: "4.4-fixture" }).verifiedFiles).toBe(12);
  });

  it("keeps referenced staging durable when the prepared journal hook crashes", async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "offline-wiki-crash-"));
    await buildOfflineWiki({ releasesRoot: fixtureRoot, editorialRoot: join(repositoryRoot, "data", "offline-wiki"), releaseId: "4.4-fixture", outputRoot, loreRoot, renderPdf: fakePdf });
    await expect(buildOfflineWiki({
      releasesRoot: fixtureRoot, editorialRoot: join(repositoryRoot, "data", "offline-wiki"),
      releaseId: "4.4-fixture", outputRoot, loreRoot: emptyLoreFixture(), renderPdf: fakePdf,
      fileOperationsForTest: { afterJournalPhase: (phase) => { if (phase === "prepared") throw new Error("prepared crash"); } },
    })).rejects.toThrow(/prepared crash/);
    expect(readdirSync(join(outputRoot, "builds")).some((name) => name.startsWith(".4.4-fixture.staging-"))).toBe(true);
    await expect(buildOfflineWiki({ releasesRoot: fixtureRoot, editorialRoot: join(repositoryRoot, "data", "offline-wiki"), releaseId: "4.4-fixture", outputRoot, loreRoot, renderPdf: async () => { throw new Error("stop after recovery"); } })).rejects.toThrow(/stop after recovery/);
    expect(verifyOfflineWiki({ outputRoot, releaseId: "4.4-fixture" }).verifiedFiles).toBe(12);
  });

  it("recognizes a no-prior expected final promoted before the prepared journal advanced", async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "offline-wiki-crash-"));
    await expect(buildOfflineWiki({ releasesRoot: fixtureRoot, editorialRoot: join(repositoryRoot, "data", "offline-wiki"), releaseId: "4.4-fixture", outputRoot, loreRoot, renderPdf: fakePdf,
      fileOperationsForTest: { afterPromoteRename: () => { throw new Error("simulated crash"); } },
    })).rejects.toThrow(/simulated crash/);
    await expect(buildOfflineWiki({ releasesRoot: fixtureRoot, editorialRoot: join(repositoryRoot, "data", "offline-wiki"), releaseId: "4.4-fixture", outputRoot, loreRoot, renderPdf: async () => { throw new Error("stop after recovery"); } })).rejects.toThrow(/stop after recovery/);
    expect(verifyOfflineWiki({ outputRoot, releaseId: "4.4-fixture" }).verifiedFiles).toBe(12);
  });

  it("keeps the expected promoted final and disposes a partially deleted prior backup", async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "offline-wiki-crash-"));
    await buildOfflineWiki({ releasesRoot: fixtureRoot, editorialRoot: join(repositoryRoot, "data", "offline-wiki"), releaseId: "4.4-fixture", outputRoot, loreRoot, renderPdf: fakePdf });
    await expect(buildOfflineWiki({ releasesRoot: fixtureRoot, editorialRoot: join(repositoryRoot, "data", "offline-wiki"), releaseId: "4.4-fixture", outputRoot, loreRoot: emptyLoreFixture(), renderPdf: fakePdf,
      fileOperationsForTest: { afterJournalPhase: (phase) => { if (phase === "promoted") throw new Error("simulated crash"); } },
    })).rejects.toThrow(/simulated crash/);
    const buildsRoot = join(outputRoot, "builds");
    const backup = readdirSync(buildsRoot).find((name) => name.includes(".backup-"))!;
    rmSync(join(buildsRoot, backup, "build-manifest.json"));
    await expect(buildOfflineWiki({ releasesRoot: fixtureRoot, editorialRoot: join(repositoryRoot, "data", "offline-wiki"), releaseId: "4.4-fixture", outputRoot, loreRoot, renderPdf: async () => { throw new Error("stop after recovery"); } })).rejects.toThrow(/stop after recovery/);
    expect(verifyOfflineWiki({ outputRoot, releaseId: "4.4-fixture" }).verifiedFiles).toBe(8);
    expect(readdirSync(buildsRoot).some((name) => name.includes(".backup-") || name.includes("transaction.json"))).toBe(false);
  });

  it("recovers a unique verified legacy backup when final is missing", async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "offline-wiki-legacy-"));
    await buildOfflineWiki({ releasesRoot: fixtureRoot, editorialRoot: join(repositoryRoot, "data", "offline-wiki"), releaseId: "4.4-fixture", outputRoot, loreRoot, renderPdf: fakePdf });
    const buildsRoot = join(outputRoot, "builds");
    renameSync(join(buildsRoot, "4.4-fixture"), join(buildsRoot, "4.4-fixture.backup-legacy"));
    await expect(buildOfflineWiki({ releasesRoot: fixtureRoot, editorialRoot: join(repositoryRoot, "data", "offline-wiki"), releaseId: "4.4-fixture", outputRoot, loreRoot, renderPdf: async () => { throw new Error("stop after recovery"); } })).rejects.toThrow(/stop after recovery/);
    expect(verifyOfflineWiki({ outputRoot, releaseId: "4.4-fixture" }).verifiedFiles).toBe(12);
    expect(readdirSync(buildsRoot).filter((name) => name.includes(".backup-"))).toEqual([]);
  });

  it("holds an exclusive build lock and cleans only canonical unreferenced staging siblings", async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "offline-wiki-lock-"));
    const buildsRoot = join(outputRoot, "builds"); mkdirSync(buildsRoot);
    const orphan = join(buildsRoot, ".4.4-fixture.staging-orphan"); mkdirSync(orphan);
    let nestedRejected = false;
    let first = true;
    await buildOfflineWiki({ releasesRoot: fixtureRoot, editorialRoot: join(repositoryRoot, "data", "offline-wiki"), releaseId: "4.4-fixture", outputRoot, loreRoot,
      renderPdf: async (input) => {
        if (first) {
          first = false;
          await expect(buildOfflineWiki({ releasesRoot: fixtureRoot, editorialRoot: join(repositoryRoot, "data", "offline-wiki"), releaseId: "4.4-fixture", outputRoot, loreRoot, renderPdf: fakePdf })).rejects.toThrow(/active|lock/i);
          nestedRejected = true;
        }
        return fakePdf(input);
      },
    });
    expect(nestedRejected).toBe(true);
    expect(existsSync(orphan)).toBe(false);
  });

  it("restores the prior build from a backed-up phase crash", async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "offline-wiki-crash-"));
    await buildOfflineWiki({ releasesRoot: fixtureRoot, editorialRoot: join(repositoryRoot, "data", "offline-wiki"), releaseId: "4.4-fixture", outputRoot, loreRoot, renderPdf: fakePdf });
    await expect(buildOfflineWiki({
      releasesRoot: fixtureRoot, editorialRoot: join(repositoryRoot, "data", "offline-wiki"),
      releaseId: "4.4-fixture", outputRoot, loreRoot: emptyLoreFixture(), renderPdf: fakePdf,
      fileOperationsForTest: { afterJournalPhase: (phase) => { if (phase === "backed-up") throw new Error("backed-up crash"); } },
    })).rejects.toThrow(/backed-up crash/);
    await expect(buildOfflineWiki({ releasesRoot: fixtureRoot, editorialRoot: join(repositoryRoot, "data", "offline-wiki"), releaseId: "4.4-fixture", outputRoot, loreRoot, renderPdf: async () => { throw new Error("stop after recovery"); } })).rejects.toThrow(/stop after recovery/);
    expect(verifyOfflineWiki({ outputRoot, releaseId: "4.4-fixture" }).verifiedFiles).toBe(12);
  });

  it("recognizes the expected final when promotion happened while the journal says backed-up", async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "offline-wiki-crash-"));
    await buildOfflineWiki({ releasesRoot: fixtureRoot, editorialRoot: join(repositoryRoot, "data", "offline-wiki"), releaseId: "4.4-fixture", outputRoot, loreRoot, renderPdf: fakePdf });
    await expect(buildOfflineWiki({
      releasesRoot: fixtureRoot, editorialRoot: join(repositoryRoot, "data", "offline-wiki"),
      releaseId: "4.4-fixture", outputRoot, loreRoot: emptyLoreFixture(), renderPdf: fakePdf,
      fileOperationsForTest: { afterPromoteRename: () => { throw new Error("promote rename crash"); } },
    })).rejects.toThrow(/promote rename crash/);
    await expect(buildOfflineWiki({ releasesRoot: fixtureRoot, editorialRoot: join(repositoryRoot, "data", "offline-wiki"), releaseId: "4.4-fixture", outputRoot, loreRoot, renderPdf: async () => { throw new Error("stop after recovery"); } })).rejects.toThrow(/stop after recovery/);
    expect(verifyOfflineWiki({ outputRoot, releaseId: "4.4-fixture" }).verifiedFiles).toBe(8);
  });

  it("restores the complete prior backup when an expected promoted final disappears", async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "offline-wiki-crash-"));
    await buildOfflineWiki({ releasesRoot: fixtureRoot, editorialRoot: join(repositoryRoot, "data", "offline-wiki"), releaseId: "4.4-fixture", outputRoot, loreRoot, renderPdf: fakePdf });
    await expect(buildOfflineWiki({
      releasesRoot: fixtureRoot, editorialRoot: join(repositoryRoot, "data", "offline-wiki"),
      releaseId: "4.4-fixture", outputRoot, loreRoot: emptyLoreFixture(), renderPdf: fakePdf,
      fileOperationsForTest: { afterJournalPhase: (phase) => { if (phase === "promoted") throw new Error("promoted crash"); } },
    })).rejects.toThrow(/promoted crash/);
    rmSync(join(outputRoot, "builds", "4.4-fixture"), { recursive: true });
    await expect(buildOfflineWiki({ releasesRoot: fixtureRoot, editorialRoot: join(repositoryRoot, "data", "offline-wiki"), releaseId: "4.4-fixture", outputRoot, loreRoot, renderPdf: async () => { throw new Error("stop after recovery"); } })).rejects.toThrow(/stop after recovery/);
    expect(verifyOfflineWiki({ outputRoot, releaseId: "4.4-fixture" }).verifiedFiles).toBe(12);
  });

  it("cleans one complete legacy backup beside a verified active final", async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "offline-wiki-legacy-"));
    await buildOfflineWiki({ releasesRoot: fixtureRoot, editorialRoot: join(repositoryRoot, "data", "offline-wiki"), releaseId: "4.4-fixture", outputRoot, loreRoot, renderPdf: fakePdf });
    const buildsRoot = join(outputRoot, "builds");
    cpSync(join(buildsRoot, "4.4-fixture"), join(buildsRoot, "4.4-fixture.backup-legacy"), { recursive: true });
    await expect(buildOfflineWiki({ releasesRoot: fixtureRoot, editorialRoot: join(repositoryRoot, "data", "offline-wiki"), releaseId: "4.4-fixture", outputRoot, loreRoot, renderPdf: async () => { throw new Error("stop after recovery"); } })).rejects.toThrow(/stop after recovery/);
    expect(readdirSync(buildsRoot).filter((name) => name.includes(".backup-"))).toEqual([]);
    expect(verifyOfflineWiki({ outputRoot, releaseId: "4.4-fixture" }).verifiedFiles).toBe(12);
  });

  it("reclaims a dead lock but rejects an orphan staging symlink without touching its target", async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "offline-wiki-lock-"));
    const buildsRoot = join(outputRoot, "builds"); mkdirSync(buildsRoot);
    writeFileSync(join(buildsRoot, ".4.4-fixture.build-transaction.lock"), JSON.stringify({ pid: 2_147_483_647, nonce: "00000000-0000-4000-8000-000000000000" }));
    const outside = mkdtempSync(join(tmpdir(), "offline-wiki-orphan-target-")); writeFileSync(join(outside, "keep"), "keep");
    symlinkSync(outside, join(buildsRoot, ".4.4-fixture.staging-orphan"), "dir");
    await expect(buildOfflineWiki({ releasesRoot: fixtureRoot, editorialRoot: join(repositoryRoot, "data", "offline-wiki"), releaseId: "4.4-fixture", outputRoot, loreRoot, renderPdf: fakePdf })).rejects.toThrow(/symlink|unsafe/i);
    expect(readFileSync(join(outside, "keep"), "utf8")).toBe("keep");
  });

  it("rejects a strict journal with unknown fields without deleting artifacts", async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "offline-wiki-journal-"));
    await buildOfflineWiki({ releasesRoot: fixtureRoot, editorialRoot: join(repositoryRoot, "data", "offline-wiki"), releaseId: "4.4-fixture", outputRoot, loreRoot, renderPdf: fakePdf });
    const buildsRoot = join(outputRoot, "builds");
    writeFileSync(join(buildsRoot, ".4.4-fixture.build-transaction.json"), JSON.stringify({ schemaVersion: 1, extra: "bad" }));
    await expect(buildOfflineWiki({ releasesRoot: fixtureRoot, editorialRoot: join(repositoryRoot, "data", "offline-wiki"), releaseId: "4.4-fixture", outputRoot, loreRoot, renderPdf: fakePdf })).rejects.toThrow(/journal|malformed/i);
    expect(verifyOfflineWiki({ outputRoot, releaseId: "4.4-fixture" }).verifiedFiles).toBe(12);
  });
});
