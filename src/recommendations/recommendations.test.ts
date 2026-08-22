import { describe, expect, it } from "vitest";
import communityJson from "../../data/community/teams.json";
import { CommunityTeamLibrarySchema, type TeamPreset } from "../domain/community";
import { fixtureBundle } from "../effects/__fixtures__/goldenTeams";
import { RecommendationConstraintError } from "./request";
import { recommendTeams } from "./recommendTeams";

const allCharacters = fixtureBundle.entities.characters.map(({ logicalId }) => logicalId);
const context = {
  bundle: fixtureBundle,
  communityPresets: CommunityTeamLibrarySchema.parse(communityJson).presets,
};
const request = {
  releaseId: fixtureBundle.release.id,
  roster: { mode: "unrestricted" as const },
  requiredCharacterIds: ["character:synthetic-dps"],
  excludedCharacterIds: [],
  encounter: { mode: "standard" as const, enemyWeaknesses: ["synthetic"] },
  objective: "maximum-synergy" as const,
  archetype: "follow-up",
  maxResults: 3,
  maxCombinations: 100,
};

describe("recommendTeams", () => {
  it("returns identical rankings, score components, and audit evidence for identical input", () => {
    const first = recommendTeams(request, context);
    const second = recommendTeams(request, context);

    expect(second).toEqual(first);
    expect(first).toHaveLength(3);
    expect(first[0]).toMatchObject({
      weightsVersion: "recommendation-weights-v2",
      components: { roleCoverage: expect.any(Number), buffApplicability: expect.any(Number) },
      explanation: { evidenceIds: expect.arrayContaining([expect.stringContaining("4.3-fixture")]) },
      audit: { evaluatedCombinationCount: expect.any(Number), excluded: expect.any(Array) },
    });
  });

  it("is invariant to roster, required, excluded, weakness, character, and preset order", () => {
    const first = recommendTeams(request, context);
    const reorderedContext = {
      bundle: {
        ...fixtureBundle,
        entities: {
          ...fixtureBundle.entities,
          characters: [...fixtureBundle.entities.characters].reverse(),
          effects: [...fixtureBundle.entities.effects].reverse(),
        },
      },
      communityPresets: [...context.communityPresets].reverse(),
    };
    const reordered = recommendTeams({
      ...request,
      requiredCharacterIds: [...request.requiredCharacterIds].reverse(),
      excludedCharacterIds: [...request.excludedCharacterIds].reverse(),
      encounter: { ...request.encounter, enemyWeaknesses: [...request.encounter.enemyWeaknesses].reverse() },
    }, reorderedContext);

    expect(reordered).toEqual(first);
  });

  it("never recommends an unowned character in owned-only mode", () => {
    const owned = allCharacters.filter((id) => id !== "character:synthetic-breaker");
    const results = recommendTeams({
      ...request,
      roster: { mode: "owned-only", characterIds: [...owned].reverse() },
    }, context);

    expect(results.flatMap((result) => result.team)).not.toContain("character:synthetic-breaker");
    expect(results.every((result) => result.team.every((id) => owned.includes(id)))).toBe(true);
  });

  it("throws a structured conflict before evaluation when constraints leave fewer than four characters", () => {
    expect(() => recommendTeams({
      ...request,
      roster: { mode: "owned-only", characterIds: allCharacters.slice(0, 3) },
    }, context)).toThrow(RecommendationConstraintError);
    try {
      recommendTeams({ ...request, roster: { mode: "owned-only", characterIds: allCharacters.slice(0, 3) } }, context);
    } catch (error) {
      expect((error as RecommendationConstraintError).issues).toEqual([
        expect.objectContaining({ code: "insufficient_roster", availableCount: 3, requiredCount: 4 }),
      ]);
    }
  });

  it("caps community prior and cannot use it to admit or outrank an illegal candidate", () => {
    const preset = context.communityPresets[0];
    const results = recommendTeams({
      ...request,
      roster: { mode: "owned-only", characterIds: allCharacters.filter((id) => id !== preset.slots[0]) },
      requiredCharacterIds: [],
    }, context);

    expect(results.every((result) => result.components.communityPrior <= 1)).toBe(true);
    expect(results.every((result) => result.weighted.communityPrior <= 5)).toBe(true);
    expect(results.flatMap((result) => result.team)).not.toContain(preset.slots[0]);
  });

  it("exposes single-slot substitutions with score deltas and sourced community references", () => {
    const [result] = recommendTeams(request, context);

    expect(result.substitutions.length).toBeGreaterThan(0);
    expect(result.substitutions[0]).toMatchObject({
      slot: expect.any(Number),
      replacing: expect.stringMatching(/^character:/),
      replacement: expect.stringMatching(/^character:/),
      componentDeltas: expect.any(Object),
    });
    expect(result.communityReferences[0]).toMatchObject({
      presetId: expect.any(String), sourceUrl: expect.stringMatching(/^https:/),
      author: expect.any(String), publisher: expect.any(String), boundedContribution: expect.any(Number),
    });
  });

  it("honors cancellation and a hard combination budget", () => {
    const controller = new AbortController();
    controller.abort();
    expect(() => recommendTeams(request, { ...context, signal: controller.signal })).toThrow(/cancelled/i);

    const [result] = recommendTeams({ ...request, maxCombinations: 1, maxResults: 1 }, context);
    expect(result.audit.evaluatedCombinationCount).toBeLessThanOrEqual(1);
    expect(result.audit.truncated).toBe(true);
  });
});

function eligiblePreset(changes: Partial<TeamPreset> = {}): TeamPreset {
  const slots: TeamPreset["slots"] = ["character:synthetic-dps", "character:synthetic-support", "character:synthetic-sub-dps", "character:synthetic-sustain"];
  return { id: "team:eligible", releaseId: fixtureBundle.release.id, gameVersion: fixtureBundle.release.gameVersion, channel: "fixture", slots,
    memberAssumptions: slots.map(() => ({ eidolon: 0, equipment: { status: "none" as const, reason: "test" } })) as TeamPreset["memberAssumptions"],
    substitutions: [], requirements: ["test"], investment: "low", tags: ["test"], summary: "eligible test preset",
    source: { url: "https://example.invalid/team", title: "test", author: "test", publisher: "test",
      publication: { status: "published", publishedAt: "2026-08-01T00:00:00.000Z" }, retrievedAt: "2026-08-02T00:00:00.000Z", availability: "available" }, ...changes };
}

it("isolates illegal equipment and investment candidates instead of stopping or silently clamping", () => {
  const illegal = recommendTeams({ ...request, requiredCharacterIds: [] }, { ...context, memberBuilds: {
    "character:synthetic-breaker": { eidolon: 0, lightCone: { logicalId: "light-cone:synthetic-cone", superimposition: 1 } },
  } });
  expect(illegal.length).toBeGreaterThan(0);
  expect(illegal[0].audit.excluded).toEqual(expect.arrayContaining([expect.objectContaining({ reason: "invalid_build", team: expect.arrayContaining(["character:synthetic-breaker"]) })]));
  expect(illegal.every((result) => !result.team.includes("character:synthetic-breaker"))).toBe(true);
  const invested = recommendTeams({ ...request, requiredCharacterIds: [], investment: { maxEidolon: 0 } }, { ...context, memberBuilds: { "character:synthetic-breaker": { eidolon: 6 } } });
  expect(invested[0].audit.excluded).toEqual(expect.arrayContaining([expect.objectContaining({ reason: "investment_constraint", detail: expect.stringContaining("max eidolon") })]));
});

it("zeros an ineligible community prior with reasons", () => {
  const [result] = recommendTeams({ ...request, objective: "low-investment" }, { ...context, communityPresets: [eligiblePreset({ investment: "high" })] });
  expect(result.communityReferences[0]).toMatchObject({ boundedContribution: 0, eligibilityIssues: expect.arrayContaining([expect.stringContaining("low investment")]) });
  expect(result.components.communityPrior).toBe(0);
});

it("returns all ten applied weights and low-investment scoring reacts to actual builds", () => {
  const memberBuilds = { "character:synthetic-support": { eidolon: 0, lightCone: { logicalId: "light-cone:synthetic-cone", superimposition: 1 } } };
  const normal = recommendTeams({ ...request, requiredCharacterIds: ["character:synthetic-dps", "character:synthetic-support"] }, { ...context, memberBuilds })[0];
  const low = recommendTeams({ ...request, requiredCharacterIds: ["character:synthetic-dps", "character:synthetic-support"], objective: "low-investment" }, { ...context, memberBuilds })[0];
  expect(Object.keys(low.appliedWeights).sort()).toEqual(Object.keys(low.components).sort());
  expect(low.weightsVersion).toBe("recommendation-weights-v2");
  expect(low.appliedWeights.activationCost).toBeLessThan(normal.appliedWeights.activationCost);
  expect(low.totalScore).toBeLessThan(normal.totalScore);
});

it("uses explicit versioned mixed roles and is invariant to weakness and allowlist order", () => {
  const bundle = structuredClone(fixtureBundle);
  const mixed = bundle.entities.characters.find(({ logicalId }) => logicalId === "character:synthetic-sub-dps")!;
  const equipment = bundle.entities.equipment[0]!;
  bundle.entities.equipment.push({ ...structuredClone(equipment), logicalId: "light-cone:other", revisionId: "light-cone:other@4.3-fixture", pathRestriction: null });
  const memberBuilds = { "character:synthetic-support": { eidolon: 0, lightCone: { logicalId: "light-cone:synthetic-cone", superimposition: 1 } } };
  mixed.name = "无职责名称"; mixed.path = "unknown"; mixed.roles = ["damage", "support"];
  const reorderedBundle = structuredClone(bundle); reorderedBundle.entities.equipment.reverse();
  const first = recommendTeams({ ...request, encounter: { mode: "standard", enemyWeaknesses: ["wind", "synthetic"] }, investment: { allowedLightConeIds: ["light-cone:other", "light-cone:synthetic-cone"] } }, { ...context, bundle, memberBuilds });
  const second = recommendTeams({ ...request, encounter: { mode: "standard", enemyWeaknesses: ["synthetic", "wind"] }, investment: { allowedLightConeIds: ["light-cone:synthetic-cone", "light-cone:other"] } }, { ...context, bundle: reorderedBundle, memberBuilds });
  expect(second).toEqual(first);
  expect(first.find((result) => result.team.includes("character:synthetic-sub-dps"))!.roles["character:synthetic-sub-dps"]).toEqual(["damage", "support"]);
});
