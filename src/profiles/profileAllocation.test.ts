import { describe, expect, it } from "vitest";
import type { AccountProfile } from "../domain/profiles";
import { maxInvestmentFixture } from "../recommendations/__fixtures__/maxInvestment";
import { allocateProfileMemberBuilds } from "./profileAllocation";

function accountProfile(): { profile: AccountProfile; bundle: ReturnType<typeof maxInvestmentFixture>["bundle"] } {
  const { bundle } = maxInvestmentFixture();
  const characterIds = bundle.entities.characters.map(({ logicalId }) => logicalId).sort();
  const cone = bundle.entities.equipment.find(({ kind }) => kind === "light-cone")!;
  cone.pathRestriction = null;
  const relic = bundle.entities.equipment.find(({ kind }) => kind === "relic-set")!;
  return {
    bundle,
    profile: {
      schemaVersion: 1, uid: "100000001", dataReleaseId: bundle.release.id,
      updatedAt: "2026-08-21T00:00:00.000Z",
      characters: characterIds.map((logicalId) => ({ logicalId, eidolon: 1, level: 80 })),
      lightCones: [{ logicalId: cone.logicalId, superimposition: 2, level: 80 }],
      relics: Array.from({ length: 4 }, (_, index) => ({
        instanceId: `relic:${index}`, setLogicalId: relic.logicalId, slot: `slot:${index}`,
      })),
    },
  };
}

describe("allocateProfileMemberBuilds", () => {
  it("caps configured investments to authoritative inventory and never reuses instances", () => {
    const { profile, bundle } = accountProfile();
    const characterIds = profile.characters.map(({ logicalId }) => logicalId);
    const compatibleId = characterIds[0]!;
    const otherId = characterIds[1]!;
    const coneId = profile.lightCones[0]!.logicalId;
    const relicId = profile.relics[0]!.setLogicalId;
    const configured = Object.fromEntries([otherId, compatibleId].map((characterId) => [characterId, {
      eidolon: 6,
      lightCone: { logicalId: coneId, superimposition: 5 },
      relicSets: [{ logicalId: relicId, pieces: 4 }],
    }]));

    const allocation = allocateProfileMemberBuilds(profile, bundle, configured);
    const builds = characterIds.map((id) => allocation.memberBuilds[id]!);
    expect(builds.every(({ eidolon }) => eidolon === 1)).toBe(true);
    expect(builds.filter(({ lightCone }) => lightCone).map(({ lightCone }) => lightCone))
      .toEqual([{ logicalId: coneId, superimposition: 2 }]);
    expect(builds.flatMap(({ relicSets }) => relicSets ?? []).reduce((sum, item) => sum + item.pieces, 0)).toBe(4);
    expect(allocation.exclusions.map(({ code }) => code)).toEqual(expect.arrayContaining([
      "eidolon_capped", "superimposition_capped", "light_cone_unavailable", "relic_pieces_capped",
    ]));
  });

  it("round-robins a large same-set inventory without duplicate sets or hanging", () => {
    const { profile, bundle } = accountProfile();
    profile.characters = profile.characters.slice(0, 2);
    const relic = profile.relics[0]!;
    profile.relics = Array.from({ length: 24 }, (_, index) => ({
      ...relic, instanceId: `large-relic:${index}`, slot: `slot:${index}`,
    }));
    const allocation = allocateProfileMemberBuilds(profile, bundle);
    const sets = profile.characters.map(({ logicalId }) => allocation.memberBuilds[logicalId]!.relicSets ?? []);
    expect(sets).toEqual([
      [{ logicalId: relic.setLogicalId, pieces: 6 }],
      [{ logicalId: relic.setLogicalId, pieces: 6 }],
    ]);
    expect(sets.every((items) => new Set(items.map(({ logicalId }) => logicalId)).size === items.length)).toBe(true);
  });

  it("is deterministic across configured record insertion order", () => {
    const { profile, bundle } = accountProfile();
    const ids = profile.characters.slice(0, 3).map(({ logicalId }) => logicalId);
    const entries = ids.map((id) => [id, { eidolon: 1 }] as const);
    const forward = allocateProfileMemberBuilds(profile, bundle, Object.fromEntries(entries));
    const reverse = allocateProfileMemberBuilds(profile, bundle, Object.fromEntries([...entries].reverse()));
    expect(reverse).toEqual(forward);
  });
});
