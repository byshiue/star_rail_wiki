import { describe, expect, it } from "vitest";
import teamsJson from "../data/community/teams.json";
import entitiesJson from "../data/fixtures/release-4.3/entities.json";
import releaseJson from "../data/fixtures/release-4.3/release.json";
import { createTeamBuildFromPreset } from "../src/community/teamRepository";
import { CommunityTeamLibrarySchema, TeamPresetSchema } from "../src/domain/community";
import { GameReleaseBundleSchema, ReleaseIndexSchema } from "../src/domain/releases";
import { validateCommunityRepository } from "./validate-community-teams";

function repositoryInputs() {
  const bundle = GameReleaseBundleSchema.parse({ release: releaseJson, entities: entitiesJson });
  const index = ReleaseIndexSchema.parse({ currentReleaseId: null, releases: [releaseJson] });
  return { index, bundles: new Map([[bundle.release.id, bundle]]) };
}

describe("community repository composition", () => {
  it("accepts the checked fixture only when every release and character reference resolves", () => {
    const { index, bundles } = repositoryInputs();
    const fixtureLibrary = {
      ...teamsJson, libraryKind: "fixture-only" as const, currentReleaseId: null,
      presets: teamsJson.presets.filter((preset) => preset.channel === "fixture"),
    };
    const library = validateCommunityRepository(fixtureLibrary, index, bundles);

    expect(library.libraryKind).toBe("fixture-only");
    expect(library.currentReleaseId).toBeNull();
    expect(library.presets[0]?.source.availability).toBe("unavailable");
    expect(library.presets[0]?.slots).toEqual([
      "character:synthetic-dps",
      "character:synthetic-support",
      "character:synthetic-sub-dps",
      "character:synthetic-sustain",
    ]);

    const build = createTeamBuildFromPreset(library.presets[0]!, bundles.get("4.3-fixture")!);
    expect(build.releaseId).toBe("4.3-fixture");
    expect(build.members).toEqual([
      {
        slotId: "slot-1",
        characterLogicalId: "character:synthetic-dps",
        eidolon: 0,
        lightCone: undefined,
      },
      {
        slotId: "slot-2",
        characterLogicalId: "character:synthetic-support",
        eidolon: 0,
        lightCone: { logicalId: "light-cone:synthetic-cone", superimposition: 1 },
      },
      {
        slotId: "slot-3",
        characterLogicalId: "character:synthetic-sub-dps",
        eidolon: 0,
        lightCone: undefined,
      },
      {
        slotId: "slot-4",
        characterLogicalId: "character:synthetic-sustain",
        eidolon: 0,
        lightCone: undefined,
      },
    ]);
    expect(build.communityPreset?.presetId).toBe("team:synthetic-follow-up-fixture");
  });

  it.each([
    ["orphan release", (value: Record<string, unknown>) => { value.releaseId = "missing-release"; }, /unknown release/i],
    ["game version mismatch", (value: Record<string, unknown>) => { value.gameVersion = "9.9"; }, /gameVersion/i],
    ["channel mismatch", (value: Record<string, unknown>) => { value.channel = "released"; }, /channel/i],
    ["orphan primary", (value: Record<string, unknown>) => {
      (value.slots as string[])[0] = "character:missing";
    }, /unknown active character.*primary/i],
    ["orphan substitute", (value: Record<string, unknown>) => {
      ((value.substitutions as Array<Record<string, unknown>>)[0]!).characterLogicalId = "character:missing";
    }, /unknown active character.*substitution/i],
  ])("rejects %s against the exact release bundle", (_label, mutate, expected) => {
    const { index, bundles } = repositoryInputs();
    const input = structuredClone(teamsJson) as unknown as { presets: Array<Record<string, unknown>> };
    mutate(input.presets[0]!);
    if (_label === "channel mismatch") (input as unknown as Record<string, unknown>).libraryKind = "mixed";

    expect(() => validateCommunityRepository(input, index, bundles)).toThrow(expected);
  });

  it.each([
    ["an incompatible light cone", (preset: Record<string, unknown>) => {
      const assumptions = preset.memberAssumptions as Array<Record<string, unknown>>;
      assumptions[0]!.equipment = {
        status: "specified", logicalId: "light-cone:synthetic-cone", superimposition: 1,
      };
    }, /incompatible/i],
    ["an eidolon above the character revision limit", (preset: Record<string, unknown>) => {
      const assumptions = preset.memberAssumptions as Array<Record<string, unknown>>;
      assumptions[0]!.eidolon = 1;
    }, /eidolon/i],
  ])("rejects %s through the authoritative handoff legality check", (_label, mutate, expected) => {
    const { index, bundles } = repositoryInputs();
    const input = structuredClone(teamsJson) as unknown as { presets: Array<Record<string, unknown>> };
    mutate(input.presets[0]!);

    expect(() => validateCommunityRepository(input, index, bundles)).toThrow(expected);
  });
});

describe("bounded preset schema", () => {
  const validPreset = () => structuredClone(teamsJson.presets[0]);

  it.each(["not a url", "javascript:alert(1)", "ftp://example.com/team", "http://example.com/team"])(
    "rejects non-HTTPS source URL %s",
    (url) => {
      const preset = validPreset();
      preset.source.url = url;
      const parse = () => TeamPresetSchema.safeParse(preset);
      expect(parse).not.toThrow();
      expect(parse().success).toBe(false);
    },
  );

  it("requires an explicit valid publication date or unknown reason", () => {
    const missing = validPreset() as unknown as Record<string, unknown>;
    const source = missing.source as Record<string, unknown>;
    delete source.publication;
    expect(() => TeamPresetSchema.parse(missing)).toThrow();

    const unknown = validPreset() as unknown as { source: Record<string, unknown> };
    unknown.source.publication = { status: "unknown", reason: "原页面未标注发布日期" };
    expect(TeamPresetSchema.parse(unknown).source.publication).toEqual({
      status: "unknown", reason: "原页面未标注发布日期",
    });

    const invalid = validPreset() as unknown as { source: Record<string, unknown> };
    invalid.source.publication = { status: "published", publishedAt: "not-a-date" };
    expect(() => TeamPresetSchema.parse(invalid)).toThrow();
  });

  it.each([
    ["blank summary", (preset: ReturnType<typeof validPreset>) => { preset.summary = "   "; }],
    ["long note", (preset: ReturnType<typeof validPreset>) => { preset.substitutions[0]!.note = "x".repeat(201); }],
    ["too many requirements", (preset: ReturnType<typeof validPreset>) => { preset.requirements = Array(9).fill("要求"); }],
    ["too many tags", (preset: ReturnType<typeof validPreset>) => { preset.tags = Array.from({ length: 9 }, (_, index) => `标签${index}`); }],
    ["duplicate primary", (preset: ReturnType<typeof validPreset>) => { preset.slots[1] = preset.slots[0]; }],
    ["primary as substitute", (preset: ReturnType<typeof validPreset>) => {
      preset.substitutions[0]!.characterLogicalId = preset.slots[0];
    }],
    ["duplicate substitute", (preset: ReturnType<typeof validPreset>) => {
      preset.substitutions.push({ ...preset.substitutions[0]!, slot: 3 });
    }],
  ])("rejects %s", (_label, mutate) => {
    const preset = validPreset();
    mutate(preset);
    expect(() => TeamPresetSchema.parse(preset)).toThrow();
  });

  it("rejects invalid substitution slots", () => {
    const preset = validPreset() as unknown as { substitutions: Array<Record<string, unknown>> };
    preset.substitutions[0]!.slot = 4;
    expect(() => TeamPresetSchema.parse(preset)).toThrow();
  });

  it("keeps fixture-only mode explicit and rejects released records in it", () => {
    const input = structuredClone({
      ...teamsJson, libraryKind: "fixture-only" as const, currentReleaseId: null,
      presets: teamsJson.presets.filter((preset) => preset.channel === "fixture"),
    });
    input.presets[0]!.channel = "released";
    expect(() => CommunityTeamLibrarySchema.parse(input)).toThrow(/fixture-only/i);
  });
});
