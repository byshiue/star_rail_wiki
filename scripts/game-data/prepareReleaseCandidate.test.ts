import { describe, expect, it } from "vitest";
import { requiredPaths } from "./sourceManifest";
import { validateCandidateIdentity } from "./prepareReleaseCandidate";

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
});
