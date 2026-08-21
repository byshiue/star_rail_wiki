import { cp, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { FeatureRevision } from "../../src/domain/entities";
import { EffectSchema } from "../../src/domain/effects";
import { GameReleaseBundleSchema } from "../../src/domain/releases";
import entitiesFixture from "../../data/fixtures/release-4.3/entities.json";
import releaseFixture from "../../data/fixtures/release-4.3/release.json";
import effectFixture from "../../public/data/releases/4.3-fixture/effects.json";
import { applyEffectOverlays, EffectOverlayFileSchema, type EffectOverlay } from "./applyEffectOverlays";
import { assertComplete, buildCoverageReport } from "./checkEffectCoverage";
import { extractCandidateEffects } from "./extractEffects";
import { validateRepository } from "../validate-repository";

function feature(revisionId: string, originalText: string): FeatureRevision {
  return {
    logicalId: revisionId.split("@")[0] ?? revisionId,
    revisionId,
    validFromReleaseId: "4.3-fixture",
    validToReleaseId: null,
    provenance: [{
      sourceName: "Synthetic effect test fixture",
      sourceUrl: "https://example.invalid/effects",
      sourceRevision: "4f3a91c2d847beef",
      sourcePath: "fixtures/effects.json",
      sourceChecksum: "sha256:test",
    }],
    name: "Synthetic effect",
    kind: "skill",
    originalText,
    effectIds: [],
    reviewStatus: "generated",
  };
}

const goldenCases = [
  ["team damage bonus 50%", "damage_bonus", "team"],
  ["enemy defense reduction 20%", "defense_reduction", "all-enemies"],
  ["action advance 25%", "action_advance", "single-ally"],
] as const;

describe("reviewed effect overlays", () => {
  it.each(goldenCases)("extracts a conservative candidate for %s", (text, metric, target) => {
    const [candidate] = extractCandidateEffects(feature(`ability:${metric}@4.3-fixture`, text));

    expect(candidate).toMatchObject({
      sourceRevisionId: `ability:${metric}@4.3-fixture`,
      originalText: text,
      metric,
      operation: "percent",
      value: { base: Number.parseInt(text.match(/\d+/)?.[0] ?? "0", 10) / 100, scaling: [] },
      target: { type: target },
      reviewStatus: "generated",
    });
  });

  it("does not treat unrelated numeric prose as an effect candidate", () => {
    expect(extractCandidateEffects(feature(
      "ability:lore@4.3-fixture",
      "Synthetic character number 7 entered room 12.",
    ))).toEqual([]);
  });

  it("binds every metric to its local numeric value when one segment contains multiple effects", () => {
    const candidates = extractCandidateEffects(feature(
      "ability:multi@4.3-fixture",
      "攻击力提高12%，速度提高8%，暴击率提高10%。",
    ));

    expect(candidates.map(({ metric, value }) => [metric, value.base])).toEqual([
      ["attack", 0.12],
      ["speed", 0.08],
      ["critical_rate", 0.1],
    ]);
  });

  it.each([
    ["生命值提高10%", "hp"], ["defense increases by 11%", "defense"],
    ["critical damage increases by 12%", "critical_damage"], ["击破特攻提高13%", "break_effect"],
    ["效果命中提高14%", "effect_hit_rate"], ["effect resistance increases by 15%", "effect_resistance"],
    ["受到的伤害提高16%", "vulnerability"], ["无视目标17%的防御力", "defense_ignore"],
    ["all resistance reduction 18%", "resistance_reduction"], ["action delay 19%", "action_delay"],
    ["healing increases by 20%", "healing"], ["护盾量提高21%", "shielding"],
    ["恢复2个战技点", "skill_points"], ["获得3层计数", "mechanic_counter"],
  ])("extracts the supported metric vocabulary from %s", (text, metric) => {
    expect(extractCandidateEffects(feature(`ability:${metric}@4.3-fixture`, text))[0]?.metric).toBe(metric);
  });

  it("assigns candidate IDs in source order across description segments", () => {
    const candidates = extractCandidateEffects(feature(
      "ability:ordered@4.3-fixture", "受到的伤害提高10%。攻击力提高20%。",
    ));
    expect(candidates.map(({ candidateId, metric }) => [candidateId, metric])).toEqual([
      ["ability:ordered@4.3-fixture#effect-1", "vulnerability"],
      ["ability:ordered@4.3-fixture#effect-2", "attack"],
    ]);
  });

  it.each([
    ["速度提高6点", "speed", "flat", 6],
    ["speed increases by 7", "speed", "flat", 7],
    ["Fire DMG increases by 20%", "damage_bonus", "percent", 0.2],
    ["火属性伤害提高25%", "damage_bonus", "percent", 0.25],
  ] as const)("normalizes common expression %s", (text, metric, operation, value) => {
    expect(extractCandidateEffects(feature("ability:common@4.3-fixture", text))[0]).toMatchObject({
      metric, operation, value: { base: value },
    });
  });

  it("replaces generated candidates with schema-valid reviewed and unsupported overlays", () => {
    const reviewedSource = feature("ability:reviewed@4.3-fixture", "team damage bonus 50%");
    const unsupportedSource = feature("ability:unsupported@4.3-fixture", "action advance 25%");
    const candidates = [
      ...extractCandidateEffects(reviewedSource),
      ...extractCandidateEffects(unsupportedSource),
    ];
    const overlays: EffectOverlay[] = [
      {
        candidateId: candidates[0].candidateId,
        id: "effect:reviewed@4.3-fixture",
        sourceRevisionId: reviewedSource.revisionId,
        metric: "damage_bonus",
        operation: "percent",
        value: { base: 0.5, scaling: [] },
        target: { type: "team" },
        trigger: { type: "always" },
        duration: { type: "permanent" },
        stacking: { type: "none", maxStacks: 1 },
        conditions: [],
        dispellable: null,
        reviewStatus: "reviewed",
        originalText: reviewedSource.originalText,
      },
      {
        candidateId: candidates[1].candidateId,
        id: "effect:unsupported@4.3-fixture",
        sourceRevisionId: unsupportedSource.revisionId,
        metric: "action_advance",
        operation: "percent",
        value: { base: 0.25, scaling: [] },
        target: { type: "single-ally" },
        trigger: { type: "always" },
        duration: { type: "instant" },
        stacking: { type: "none", maxStacks: 1 },
        conditions: [{ type: "unsupported", value: "ambiguous action target" }],
        dispellable: null,
        reviewStatus: "unsupported",
        originalText: unsupportedSource.originalText,
      },
    ];

    expect(applyEffectOverlays(candidates, overlays).map(({ id, reviewStatus }) => ({ id, reviewStatus }))).toEqual([
      { id: "effect:reviewed@4.3-fixture", reviewStatus: "reviewed" },
      { id: "effect:unsupported@4.3-fixture", reviewStatus: "unsupported" },
    ]);
  });

  it("rejects stale, duplicate-candidate, and duplicate-effect overlays", () => {
    const [candidate] = extractCandidateEffects(feature("ability:strict@4.3-fixture", "team damage bonus 50%"));
    const overlay = {
      candidateId: candidate.candidateId, id: "effect:strict@4.3-fixture",
      sourceRevisionId: candidate.sourceRevisionId, metric: candidate.metric,
      operation: "percent" as const, value: { base: 0.5, scaling: [] }, target: { type: "team" as const },
      trigger: { type: "always" as const }, duration: { type: "permanent" as const },
      stacking: { type: "none" as const, maxStacks: 1 as const }, conditions: [], dispellable: null,
      reviewStatus: "reviewed" as const, originalText: candidate.originalText,
    };

    expect(() => applyEffectOverlays([candidate], [{ ...overlay, candidateId: "stale#effect-1" }])).toThrow(/stale/i);
    expect(() => applyEffectOverlays([candidate], [overlay, { ...overlay, id: "effect:other" }])).toThrow(/candidateId/i);
    expect(() => applyEffectOverlays([candidate], [overlay, { ...overlay, candidateId: "other", id: overlay.id }])).toThrow(/effect id/i);
    expect(() => applyEffectOverlays([candidate], [{ ...overlay, metric: "attack" }])).toThrow(/conflicts/i);
    expect(() => applyEffectOverlays([candidate], [])).toThrow(/unconsumed/i);
  });

  it("rejects generated entries in the manually reviewed overlay file", () => {
    expect(() => EffectOverlayFileSchema.parse({
      schemaVersion: 1,
      overlays: [{ candidateId: "ability:fixture#effect-1", ...effectFixture[0], reviewStatus: "generated" }],
    })).toThrow();
  });
});

describe("effect completeness gate", () => {
  it("reports every required coverage count and accepts explicit unsupported effects", () => {
    const sources = [
      feature("ability:reviewed@4.3-fixture", "team damage bonus 50%"),
      feature("ability:unsupported@4.3-fixture", "action advance 25%"),
      feature("ability:none@4.3-fixture", "No numeric effect here."),
    ];
    const candidates = sources.flatMap(extractCandidateEffects);
    const effects = applyEffectOverlays(candidates, [
      {
        candidateId: candidates[0].candidateId,
        id: "effect:reviewed@4.3-fixture", sourceRevisionId: sources[0].revisionId,
        metric: "damage_bonus", operation: "percent", value: { base: 0.5, scaling: [] },
        target: { type: "team" }, trigger: { type: "always" }, duration: { type: "permanent" },
        stacking: { type: "none", maxStacks: 1 }, conditions: [], dispellable: null,
        reviewStatus: "reviewed", originalText: sources[0].originalText,
      },
      {
        candidateId: candidates[1].candidateId,
        id: "effect:unsupported@4.3-fixture", sourceRevisionId: sources[1].revisionId,
        metric: "action_advance", operation: "percent", value: { base: 0.25, scaling: [] },
        target: { type: "single-ally" }, trigger: { type: "always" }, duration: { type: "instant" },
        stacking: { type: "none", maxStacks: 1 }, conditions: [{ type: "unsupported" }], dispellable: null,
        reviewStatus: "unsupported", originalText: sources[1].originalText,
      },
    ]);

    const report = buildCoverageReport(sources, effects);
    expect(report).toEqual({
      totalSourceDescriptions: 3,
      candidateNumericEffects: 2,
      reviewedEffects: 1,
      generatedEffects: 0,
      explicitUnsupportedEffects: 1,
      unmappedEffects: 0,
    });
    expect(() => assertComplete(report)).not.toThrow();
  });

  it("fails when numeric buff text has no effect or unsupported record", () => {
    const report = buildCoverageReport([
      feature("ability:unmapped@4.3-fixture", "enemy defense reduction 20%"),
    ], []);

    expect(() => assertComplete(report)).toThrow(/unmapped numeric effect/i);
  });

  it("does not let a generated intermediate effect satisfy production coverage", () => {
    const source = feature("ability:generated@4.3-fixture", "team damage bonus 50%");
    const generated = EffectSchema.parse({ ...effectFixture[0], id: "effect:generated", sourceRevisionId: source.revisionId,
      originalText: source.originalText, value: { base: 0.5, scaling: [] }, reviewStatus: "generated" });
    const report = buildCoverageReport([source], [generated]);

    expect(report).toMatchObject({ generatedEffects: 1, unmappedEffects: 1 });
    expect(() => assertComplete(report)).toThrow(/generated effects/i);
  });

  it.each(["missing", "wrong-owner"])("rejects %s revision effect ownership", (mode) => {
    const entities = structuredClone(GameReleaseBundleSchema.parse({
      release: releaseFixture, entities: entitiesFixture,
    }).entities);
    entities.characters[0].abilities[0].effectIds = [];
    if (mode === "wrong-owner") entities.equipment[0].effectIds = [entities.effects[0].id];
    expect(() => GameReleaseBundleSchema.parse({ release: releaseFixture, entities })).toThrow(/effect ownership/i);
  });

  it("composes checked-in schema, reference, overlay, and completeness validation", async () => {
    await expect(validateRepository()).resolves.toBeUndefined();
  });

  it("rejects a fixture selected as the production current release", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "star-rail-fixture-current-"));
    const directory = path.join(root, "public/data/releases/4.3-fixture");
    await mkdir(directory, { recursive: true });
    await mkdir(path.join(root, "data/manual"), { recursive: true });
    const index = JSON.parse(await readFile("public/data/releases/index.json", "utf8"));
    index.currentReleaseId = "4.3-fixture";
    index.releases[0].channel = "released";
    const release = JSON.parse(await readFile("public/data/releases/4.3-fixture/release.json", "utf8"));
    release.channel = "released";
    await writeFile(path.join(root, "public/data/releases/index.json"), `${JSON.stringify(index, null, 2)}\n`);
    await writeFile(path.join(directory, "release.json"), `${JSON.stringify(release, null, 2)}\n`);
    await cp("public/data/releases/4.3-fixture/entities.json", path.join(directory, "entities.json"));
    await cp("public/data/releases/4.3-fixture/effects.json", path.join(directory, "effects.json"));
    await cp("public/data/releases/4.3-fixture/coverage.json", path.join(directory, "coverage.json"));
    await cp("data/manual/effects.json", path.join(root, "data/manual/effects.json"));

    await expect(validateRepository(root)).rejects.toThrow(/fixture.*current release/i);
  });

  it("rejects a repository whose checked-in coverage silently claims no unmapped effects", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "star-rail-invalid-coverage-"));
    await mkdir(path.join(root, "public/data/releases/4.3-fixture"), { recursive: true });
    await mkdir(path.join(root, "data/manual"), { recursive: true });
    await cp("public/data/releases/index.json", path.join(root, "public/data/releases/index.json"));
    await cp("public/data/releases/4.3-fixture/release.json", path.join(root, "public/data/releases/4.3-fixture/release.json"));
    await cp("public/data/releases/4.3-fixture/entities.json", path.join(root, "public/data/releases/4.3-fixture/entities.json"));
    const entities = JSON.parse(await readFile("public/data/releases/4.3-fixture/entities.json", "utf8"));
    entities.effects = [];
    entities.characters[0].abilities[0].effectIds = [];
    await writeFile(
      path.join(root, "public/data/releases/4.3-fixture/entities.json"),
      `${JSON.stringify(entities, null, 2)}\n`,
    );
    await writeFile(path.join(root, "public/data/releases/4.3-fixture/effects.json"), "[]\n");
    await writeFile(path.join(root, "public/data/releases/4.3-fixture/coverage.json"), JSON.stringify({
      totalSourceDescriptions: 2,
      candidateNumericEffects: 1,
      reviewedEffects: 0,
      generatedEffects: 0,
      explicitUnsupportedEffects: 0,
      unmappedEffects: 0,
    }));
    await writeFile(path.join(root, "data/manual/effects.json"), '{"schemaVersion":1,"overlays":[]}\n');

    await expect(validateRepository(root)).rejects.toThrow(/unmapped numeric effect|coverage report mismatch/i);
  });
});
