import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadDocumentCatalog } from "./catalog";
import type { EditorialData } from "./editorial";

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "releases");

describe("offline wiki document catalog", () => {
  it("normalizes released entities into sorted document collections with provenance", () => {
    const catalog = loadDocumentCatalog(fixtureRoot, "4.4-fixture");

    expect(catalog.release.id).toBe("4.4-fixture");
    expect(catalog.characters.map(({ logicalId, name }) => ({ logicalId, name }))).toEqual([
      { logicalId: "character:1", name: "测试角色" },
    ]);
    expect(catalog.lightCones.map(({ logicalId }) => logicalId)).toEqual(["light-cone:1"]);
    expect(catalog.relicSets.map(({ logicalId }) => logicalId)).toEqual(["relic-set:1"]);
    expect(catalog.characters[0]?.provenance[0]?.sourceRevision).toBe("abcdef12");
  });

  it("rejects a formal entity whose provenance was removed", () => {
    const temporaryRoot = mkdtempSync(join(tmpdir(), "offline-wiki-catalog-"));
    cpSync(fixtureRoot, temporaryRoot, { recursive: true });
    const entitiesPath = join(temporaryRoot, "4.4-fixture", "entities.json");
    const entities = JSON.parse(readFileSync(entitiesPath, "utf8")) as {
      characters: Array<{ provenance: unknown[] }>;
    };
    entities.characters[0]!.provenance = [];
    writeFileSync(entitiesPath, `${JSON.stringify(entities, null, 2)}\n`);

    expect(() => loadDocumentCatalog(temporaryRoot, "4.4-fixture")).toThrow(/provenance/i);
  });

  it("includes reviewed editorial coverage and Divergent Universe entries", () => {
    const editorial = {
      summaries: [{
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
      }],
      divergentUniverse: [{
        logicalId: "du:equation:1",
        kind: "equation",
        name: "测试方程",
        releaseId: "4.4-fixture",
        description: "测试方程效果。",
        provenance: [{
          sourceName: "Official public wiki",
          sourceUrl: "https://wiki.hoyolab.com/pc/hsr/entry/1",
          sourceRevision: "2026-09-06",
          sourcePath: "entry/1",
          sourceChecksum: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        }],
        reviewStatus: "reviewed",
      }],
    } satisfies EditorialData;

    const catalog = loadDocumentCatalog(fixtureRoot, "4.4-fixture", editorial);

    expect(catalog.summaryCoverage).toEqual({ reviewed: 1, missing: 2 });
    expect(catalog.divergentUniverse.map(({ logicalId }) => logicalId)).toEqual(["du:equation:1"]);
  });
});
