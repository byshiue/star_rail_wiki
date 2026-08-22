import { describe, expect, it } from "vitest";
import teamsJson from "../data/community/teams.json";
import { CommunityTeamLibrarySchema } from "../src/domain/community";
import { validateCommunitySources } from "./validate-community-teams";

describe("community team source validation", () => {
  it("rejects a preset without complete provenance", () => {
    const incompletePreset = {
      id: "team:incomplete",
      releaseId: "release-4.3",
      gameVersion: "4.3",
      channel: "released",
      slots: ["character:a", "character:b", "character:c", "character:d"],
      substitutions: [],
      requirements: ["零星魂"],
      investment: "low",
      tags: ["追击"],
      summary: "项目撰写的简短摘要。",
      source: { availability: "available" },
    };

    expect(validateCommunitySources([incompletePreset])).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "missing_provenance" }),
    ]));
  });

  it("keeps representative fixture presets out of the production current selection", () => {
    const library = CommunityTeamLibrarySchema.parse(teamsJson);

    expect(library.currentReleaseId).toBe("4.4-cn-2026-08-21");
    expect(library.presets.length).toBeGreaterThan(0);
    expect(library.presets.filter((preset) => preset.channel === "fixture")
      .every((preset) => preset.releaseId !== library.currentReleaseId)).toBe(true);
    expect(library.presets.some((preset) => preset.releaseId === library.currentReleaseId
      && preset.channel === "released" && preset.source.availability === "available")).toBe(true);
    expect(validateCommunitySources(library.presets)).toEqual([]);
  });

  it("rejects a fixture preset selected as current", () => {
    expect(() => CommunityTeamLibrarySchema.parse({
      ...teamsJson,
      currentReleaseId: teamsJson.presets[0]?.releaseId,
    })).toThrow(/current.*released/i);
  });
});
