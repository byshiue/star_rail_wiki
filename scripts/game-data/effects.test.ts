import { cp, mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { FeatureRevision } from "../../src/domain/entities";
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

  it("replaces generated candidates with schema-valid reviewed and unsupported overlays", () => {
    const reviewedSource = feature("ability:reviewed@4.3-fixture", "team damage bonus 50%");
    const unsupportedSource = feature("ability:unsupported@4.3-fixture", "action advance 25%");
    const candidates = [
      ...extractCandidateEffects(reviewedSource),
      ...extractCandidateEffects(unsupportedSource),
    ];
    const overlays: EffectOverlay[] = [
      {
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

  it("rejects generated entries in the manually reviewed overlay file", () => {
    expect(() => EffectOverlayFileSchema.parse({
      schemaVersion: 1,
      overlays: [{ ...effectFixture[0], reviewStatus: "generated" }],
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
        id: "effect:reviewed@4.3-fixture", sourceRevisionId: sources[0].revisionId,
        metric: "damage_bonus", operation: "percent", value: { base: 0.5, scaling: [] },
        target: { type: "team" }, trigger: { type: "always" }, duration: { type: "permanent" },
        stacking: { type: "none", maxStacks: 1 }, conditions: [], dispellable: null,
        reviewStatus: "reviewed", originalText: sources[0].originalText,
      },
      {
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

  it("composes checked-in schema, reference, overlay, and completeness validation", async () => {
    await expect(validateRepository()).resolves.toBeUndefined();
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
