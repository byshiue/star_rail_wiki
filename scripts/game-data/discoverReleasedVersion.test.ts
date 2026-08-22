import { describe, expect, it } from "vitest";
import { discoverReleasedVersion } from "./discoverReleasedVersion";

const official = [{
  title: 'Version 4.5 "Example" Update Details',
  url: "https://www.hoyolab.com/article/50000001",
  publishedAt: "2026-08-25T00:00:00.000Z",
}];
const dimbreath = [{
  sha: "a".repeat(40),
  message: "OSPRODWin4.5.0_D1_A1_L1",
  committedAt: "2026-08-25T01:00:00.000Z",
}];
const starRailRes = [{
  sha: "b".repeat(40),
  message: ":sparkles: Update to version 4.5",
  committedAt: "2026-08-25T02:00:00.000Z",
}];

describe("released-version discovery", () => {
  it("returns no-change when the official feed has no newer released update", () => {
    expect(discoverReleasedVersion("4.4", [], dimbreath, starRailRes, new Date("2026-08-26"))).toEqual({
      status: "no-change",
    });
  });

  it("requires official update details plus two immutable matching upstream revisions", () => {
    expect(discoverReleasedVersion("4.4", official, dimbreath, starRailRes, new Date("2026-08-26")))
      .toMatchObject({
        status: "candidate",
        gameVersion: "4.5",
        officialNoticeUrl: official[0]!.url,
        dimbreathRevision: "a".repeat(40),
        starRailResRevision: "b".repeat(40),
      });
  });

  it("fails closed for previews, future posts, mutable refs, or missing matching revisions", () => {
    const preview = [{ ...official[0]!, title: "Version 4.5 Preview Special Program" }];
    expect(discoverReleasedVersion("4.4", preview, dimbreath, starRailRes, new Date("2026-08-26")))
      .toEqual({ status: "no-change" });
    expect(discoverReleasedVersion("4.4", official, dimbreath, starRailRes, new Date("2026-08-24")))
      .toEqual({ status: "no-change" });
    expect(discoverReleasedVersion("4.4", official, [{ ...dimbreath[0]!, sha: "latest" }], starRailRes, new Date("2026-08-26")))
      .toEqual({ status: "no-change" });
    expect(discoverReleasedVersion("4.4", official, dimbreath, [], new Date("2026-08-26")))
      .toEqual({ status: "no-change" });
  });
});
