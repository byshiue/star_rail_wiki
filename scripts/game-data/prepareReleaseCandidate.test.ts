import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildRelease } from "./buildRelease";
import { loadSourceManifest, requiredPaths } from "./sourceManifest";
import { buildStableEntityDiff, validateCandidateIdentity } from "./prepareReleaseCandidate";

const discovery = {
  status: "candidate" as const,
  gameVersion: "4.5",
  officialNoticeUrl: "https://www.hoyolab.com/article/123",
  officialPublishedAt: "2026-08-20T00:00:00.000Z",
  dimbreathRevision: "a".repeat(40),
  dimbreathLabel: "OSPRODWin4.5.0_fixture",
  dimbreathCommittedAt: "2026-08-20T01:00:00.000Z",
  starRailResRevision: "b".repeat(40),
  starRailResCommittedAt: "2026-08-20T02:00:00.000Z",
};

describe("release candidate preparation boundary", () => {
  it("accepts one immutable revision and the exact import allowlist", () => {
    expect(validateCandidateIdentity(discovery, [...requiredPaths])).toEqual(discovery);
  });

  it.each([
    ["short revision", { ...discovery, starRailResRevision: "b".repeat(39) }, [...requiredPaths]],
    ["mutable path", discovery, [...requiredPaths, "index_new/cn/latest.json"]],
    ["missing path", discovery, requiredPaths.slice(1)],
    ["duplicate path", discovery, [...requiredPaths, requiredPaths[0]]],
  ])("rejects %s", (_label, candidate, paths) => {
    expect(() => validateCandidateIdentity(candidate, paths)).toThrow(/immutable|exact required source paths/i);
  });

  it("summarizes numeric Chinese text and provenance-only changes for stable logical revisions", async () => {
    const fixtureRoot = path.resolve("scripts/game-data/__fixtures__/source");
    const before = await buildRelease({
      manifest: await loadSourceManifest(path.join(fixtureRoot, "manifest.json")),
      sourceRoot: fixtureRoot,
    });
    const after = structuredClone(before);
    after.entities.characters[0].abilities[0].originalText = "使我方全体造成的伤害提高25%。";
    after.entities.characters[0].description = "更新后的中文角色介绍。";
    after.entities.equipment[0].provenance[0].sourceChecksum = `sha256:${"f".repeat(64)}`;

    const diff = buildStableEntityDiff(before, after);
    expect(diff.counts).toMatchObject({ added: 0, removed: 0, changed: 3, total: 3 });
    expect(diff.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ logicalId: "ability:100101", kind: "changed", changedFields: ["originalText"] }),
      expect.objectContaining({ logicalId: "character:1001", kind: "changed", changedFields: ["description"] }),
      expect.objectContaining({ logicalId: "light-cone:23024", kind: "changed", changedFields: ["provenance"] }),
    ]));
    expect(diff.checksums.detailsSha256).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(diff.checksums.summarySha256).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});
