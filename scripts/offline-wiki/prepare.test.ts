import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { prepareOfflineWiki } from "./prepare";

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "releases");

describe("offline wiki prepare report", () => {
  it("writes deterministic entity counts to the release build directory", () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "offline-wiki-prepare-"));

    const report = prepareOfflineWiki({
      releasesRoot: fixtureRoot,
      releaseId: "4.4-fixture",
      outputRoot,
    });

    expect(report).toMatchObject({
      schemaVersion: 1,
      releaseId: "4.4-fixture",
      gameVersion: "4.4",
      counts: { characters: 1, lightCones: 1, relicSets: 1, divergentUniverse: 0 },
      gaps: { storySummaries: 3, images: 3, divergentUniverse: 0 },
    });
    expect(report.changes).toEqual({
      baselineReleaseId: null,
      added: ["character:1", "light-cone:1", "relic-set:1"],
      changed: [],
      unchanged: [],
      removed: [],
    });
    const saved = JSON.parse(readFileSync(
      join(outputRoot, "builds", "4.4-fixture", "prepare-report.json"),
      "utf8",
    ));
    expect(saved).toEqual(report);
  });

  it("rejects mutable latest release aliases", () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "offline-wiki-prepare-"));
    expect(() => prepareOfflineWiki({ releasesRoot: fixtureRoot, releaseId: "latest", outputRoot }))
      .toThrow(/exact release id/i);
  });

  it("subtracts reviewed summaries loaded from the editorial root", () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "offline-wiki-prepare-"));
    const editorialRoot = mkdtempSync(join(tmpdir(), "offline-wiki-editorial-"));
    mkdirSync(join(editorialRoot, "summaries"), { recursive: true });
    mkdirSync(join(editorialRoot, "divergent-universe"), { recursive: true });
    writeFileSync(join(editorialRoot, "summaries", "characters.json"), JSON.stringify([{
      logicalId: "character:1",
      entityKind: "character",
      releaseId: "4.4-fixture",
      locale: "zh-CN",
      summary: "原创故事摘要。",
      contentChecksum: "sha256:ef3ad281972dbcdd4a2f01fd692a9eb7b606a65ed903772133d9dafa3e3c2bd9",
      reviewStatus: "reviewed",
      reviewer: { name: "Fixture reviewer", reviewedAt: "2026-09-06T01:00:00.000Z" },
      provenance: [{
        sourceName: "Official public wiki",
        sourceUrl: "https://wiki.hoyolab.com/pc/hsr/entry/1",
        sourceRevision: "2026-09-06",
        sourcePath: "entry/1",
        sourceChecksum: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      }],
    }]));
    writeFileSync(join(editorialRoot, "summaries", "light-cones.json"), "[]");
    writeFileSync(join(editorialRoot, "summaries", "relics.json"), "[]");
    writeFileSync(join(editorialRoot, "summaries", "divergent-universe.json"), "[]");
    writeFileSync(join(editorialRoot, "summaries", "lore.json"), "[]");
    writeFileSync(join(editorialRoot, "divergent-universe", "entries.json"), "[]");

    const report = prepareOfflineWiki({
      releasesRoot: fixtureRoot,
      releaseId: "4.4-fixture",
      outputRoot,
      editorialRoot,
    });

    expect(report.gaps.storySummaries).toBe(2);
  });
});
