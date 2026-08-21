import { describe, expect, it } from "vitest";
import releaseFixture from "../../data/fixtures/release-4.3/release.json";
import entitiesFixture from "../../data/fixtures/release-4.3/entities.json";
import { TeamPresetSchema } from "./community";
import { CharacterRevisionSchema, EquipmentRevisionSchema } from "./entities";
import {
  DurationExpressionSchema,
  EffectSchema,
  StackingRuleSchema,
  TriggerExpressionSchema,
} from "./effects";
import { AccountProfileSchema } from "./profiles";
import { DataReleaseSchema, GameReleaseBundleSchema } from "./releases";

function validEntities() {
  return structuredClone(GameReleaseBundleSchema.parse({
    release: releaseFixture,
    entities: entitiesFixture,
  }).entities);
}

describe("versioned domain schemas", () => {
  it("rejects an otherwise valid entity revision without source provenance", () => {
    const { provenance: _provenance, ...revisionWithoutProvenance } = entitiesFixture.characters[0];
    expect(() => CharacterRevisionSchema.parse(revisionWithoutProvenance)).toThrow();
  });

  it("marks the reviewed synthetic data as a fixture channel", () => {
    expect(DataReleaseSchema.parse(releaseFixture).channel).toBe("fixture");
    expect(releaseFixture.sources[0].revision).toMatch(/^[a-f0-9]{8,40}$/);
  });

  it("accepts immutable character and equipment revisions with provenance", () => {
    const parsed = GameReleaseBundleSchema.parse({ release: releaseFixture, entities: entitiesFixture });
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

  it.each([
    [{ type: "event" }, "event trigger without event"],
    [{ type: "always", event: "enemy-broken" }, "always trigger with event"],
  ])("rejects ambiguous trigger expression: %s (%s)", (trigger, _label) => {
    expect(() => TriggerExpressionSchema.parse(trigger)).toThrow();
  });

  it.each([
    [{ type: "turns" }, "turn duration without value"],
    [{ type: "permanent", value: 2 }, "permanent duration with value"],
  ])("rejects ambiguous duration expression: %s (%s)", (duration, _label) => {
    expect(() => DurationExpressionSchema.parse(duration)).toThrow();
  });

  it("rejects non-stacking rules with an arbitrary stack cap", () => {
    expect(() => StackingRuleSchema.parse({ type: "none", maxStacks: 3 })).toThrow();
  });

  it("accepts explicit trigger, duration, and stacking variants", () => {
    expect(TriggerExpressionSchema.parse({ type: "event", event: "enemy-broken" })).toEqual({
      type: "event", event: "enemy-broken",
    });
    expect(DurationExpressionSchema.parse({ type: "turns", value: 2 })).toEqual({
      type: "turns", value: 2,
    });
    expect(StackingRuleSchema.parse({ type: "additive", maxStacks: 3 })).toEqual({
      type: "additive", maxStacks: 3,
    });
  });

  it("rejects duplicate revision IDs across nested revision-bearing entities", () => {
    const entities = validEntities();
    entities.characters[0].traces = [structuredClone(entities.characters[0].abilities[0])];
    expect(() => GameReleaseBundleSchema.parse({ release: releaseFixture, entities })).toThrow(
      /duplicate revisionId/,
    );
  });

  it.each(["character", "equipment"])("rejects a dangling %s effect reference", (source) => {
    const entities = validEntities();
    if (source === "character") {
      entities.characters[0].abilities[0].effectIds = ["effect:missing@4.3-fixture"];
    } else {
      entities.equipment[0].effectIds = ["effect:missing@4.3-fixture"];
    }
    expect(() => GameReleaseBundleSchema.parse({ release: releaseFixture, entities })).toThrow(
      /dangling effectId|effect ownership/,
    );
  });

  it("rejects an effect whose source revision does not exist", () => {
    const entities = validEntities();
    entities.effects[0].sourceRevisionId = "ability:missing@4.3-fixture";
    expect(() => GameReleaseBundleSchema.parse({ release: releaseFixture, entities })).toThrow(
      /dangling sourceRevisionId/,
    );
  });

  it("isolates account data by requiring a UID and pinned release", () => {
    expect(AccountProfileSchema.parse({
      schemaVersion: 1, uid: "100000001", dataReleaseId: "4.3-fixture",
      updatedAt: "2026-08-21T00:00:00.000Z", characters: [], lightCones: [], relics: [],
    })).toMatchObject({ uid: "100000001", dataReleaseId: "4.3-fixture" });
  });

  it("requires exactly four sourced slots in a community team preset", () => {
    const preset = {
      id: "team:synthetic-fixture", releaseId: "4.3-fixture",
      slots: ["character:a", "character:b", "character:c"],
      substitutions: [], requirements: [], tags: ["合成夹具"],
      summary: "仅用于自动化测试的合成配队。",
      source: {
        url: "https://example.invalid/synthetic-team", author: "Synthetic Fixture Author",
        publishedAt: "2026-08-20T00:00:00.000Z", retrievedAt: "2026-08-21T00:00:00.000Z",
        availability: "available",
      },
    };
    expect(() => TeamPresetSchema.parse(preset)).toThrow();
  });
});
