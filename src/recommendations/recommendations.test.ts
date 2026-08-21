import { describe, expect, it } from "vitest";
import communityJson from "../../data/community/teams.json";
import { CommunityTeamLibrarySchema } from "../domain/community";
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
      weightsVersion: "recommendation-weights-v1",
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
