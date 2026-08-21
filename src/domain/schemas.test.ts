import { describe, expect, it } from "vitest";
import releaseFixture from "../../data/fixtures/release-4.3/release.json";
import entitiesFixture from "../../data/fixtures/release-4.3/entities.json";
import { TeamPresetSchema } from "./community";
import { CharacterRevisionSchema, EquipmentRevisionSchema } from "./entities";
import { EffectSchema } from "./effects";
import { AccountProfileSchema } from "./profiles";
import { DataReleaseSchema, GameReleaseBundleSchema } from "./releases";

describe("versioned domain schemas", () => {
  it("rejects an entity revision without source provenance", () => {
    expect(() => CharacterRevisionSchema.parse({ id: "char:1001@4.3" })).toThrow();
  });

  it("accepts a reviewed released-channel fixture", () => {
    expect(DataReleaseSchema.parse(releaseFixture).channel).toBe("released");
    expect(releaseFixture.sources[0].revision).toMatch(/^[a-f0-9]{8,40}$/);
  });

  it("accepts immutable character and equipment revisions with provenance", () => {
    const parsed = GameReleaseBundleSchema.parse({
      release: releaseFixture,
      entities: entitiesFixture,
    });

    expect(CharacterRevisionSchema.parse(parsed.entities.characters[0]).revisionId).toBe(
      "character:synthetic-support@4.3-fixture",
    );
    expect(EquipmentRevisionSchema.parse(parsed.entities.equipment[0]).validToReleaseId).toBeNull();
    expect(parsed.entities.characters[0].provenance[0]?.sourcePath).toBe(
      "fixtures/characters/synthetic-support.json",
    );
  });

  it("preserves a reviewed effect contract for later evaluation", () => {
    const effect = EffectSchema.parse(entitiesFixture.effects[0]);

    expect(effect).toMatchObject({
      sourceRevisionId: "ability:synthetic-support-skill@4.3-fixture",
      metric: "damage_bonus",
      operation: "percent",
      reviewStatus: "reviewed",
      originalText: "合成评审夹具：使我方全体造成的伤害提高 10%。",
    });
  });

  it("isolates account data by requiring a UID and pinned release", () => {
    expect(
      AccountProfileSchema.parse({
        schemaVersion: 1,
        uid: "100000001",
        dataReleaseId: "4.3-fixture",
        updatedAt: "2026-08-21T00:00:00.000Z",
        characters: [],
        lightCones: [],
        relics: [],
      }),
    ).toMatchObject({ uid: "100000001", dataReleaseId: "4.3-fixture" });
  });

  it("requires exactly four sourced slots in a community team preset", () => {
    const preset = {
      id: "team:synthetic-fixture",
      releaseId: "4.3-fixture",
      slots: ["character:a", "character:b", "character:c"],
      substitutions: [],
      requirements: [],
      tags: ["合成夹具"],
      summary: "仅用于自动化测试的合成配队。",
      source: {
        url: "https://example.invalid/synthetic-team",
        author: "Synthetic Fixture Author",
        publishedAt: "2026-08-20T00:00:00.000Z",
        retrievedAt: "2026-08-21T00:00:00.000Z",
        availability: "available",
      },
    };

    expect(() => TeamPresetSchema.parse(preset)).toThrow();
  });
});
