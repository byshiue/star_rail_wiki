import type { AccountProfile } from "../domain/profiles";
import type { GameReleaseBundle } from "../domain/releases";
import type { RecommendationContext } from "../recommendations/request";

export type ProfileAllocationExclusionCode =
  | "eidolon_capped" | "light_cone_unowned" | "light_cone_incompatible"
  | "light_cone_unavailable" | "superimposition_capped"
  | "relic_set_unowned" | "relic_pieces_capped";

export interface ProfileAllocationExclusion {
  code: ProfileAllocationExclusionCode;
  characterId: string;
  logicalId?: string;
  requested?: number;
  allocated?: number;
  message: string;
}

export interface ProfileAllocation {
  memberBuilds: NonNullable<RecommendationContext["memberBuilds"]>;
  exclusions: ProfileAllocationExclusion[];
}

type ConfiguredBuilds = RecommendationContext["memberBuilds"];

function coneInstanceId(cone: AccountProfile["lightCones"][number]): string {
  return cone.instanceId ?? `legacy:${cone.logicalId}`;
}

export function allocateProfileMemberBuilds(
  profile: AccountProfile, bundle: GameReleaseBundle, configured?: ConfiguredBuilds,
): ProfileAllocation {
  const characters = [...profile.characters].sort((left, right) => left.logicalId.localeCompare(right.logicalId));
  const characterById = new Map(bundle.entities.characters
    .filter(({ validToReleaseId }) => validToReleaseId === null).map((item) => [item.logicalId, item]));
  const equipmentById = new Map(bundle.entities.equipment
    .filter(({ validToReleaseId }) => validToReleaseId === null).map((item) => [item.logicalId, item]));
  const ownedCones = [...profile.lightCones].sort((left, right) =>
    left.logicalId.localeCompare(right.logicalId)
      || right.superimposition - left.superimposition
      || right.level - left.level
      || coneInstanceId(left).localeCompare(coneInstanceId(right)));
  const remainingRelics = new Map<string, number>();
  for (const relic of profile.relics) remainingRelics.set(relic.setLogicalId, (remainingRelics.get(relic.setLogicalId) ?? 0) + 1);
  const usedCones = new Set<string>();
  const exclusions: ProfileAllocationExclusion[] = [];
  const memberBuilds: NonNullable<RecommendationContext["memberBuilds"]> = {};

  for (const character of characters) {
    const requested = configured?.[character.logicalId];
    const requestedEidolon = requested?.eidolon ?? character.eidolon;
    const eidolon = Math.min(requestedEidolon, character.eidolon);
    if (requestedEidolon > character.eidolon) exclusions.push({
      code: "eidolon_capped", characterId: character.logicalId,
      requested: requestedEidolon, allocated: eidolon,
      message: `${character.logicalId} 星魂由 E${requestedEidolon} 限制为库存 E${eidolon}`,
    });

    const characterRevision = characterById.get(character.logicalId);
    let lightCone: { logicalId: string; superimposition: number } | undefined;
    const requestedCone = requested?.lightCone;
    if (requestedCone) {
      const matching = ownedCones.filter(({ logicalId }) => logicalId === requestedCone.logicalId);
      const owned = matching.find((cone) => !usedCones.has(coneInstanceId(cone)));
      const revision = equipmentById.get(requestedCone.logicalId);
      if (!matching.length) exclusions.push({ code: "light_cone_unowned", characterId: character.logicalId,
        logicalId: requestedCone.logicalId, message: `${requestedCone.logicalId} 不在所选 UID 库存中` });
      else if (revision?.kind !== "light-cone" || (revision.pathRestriction !== null
        && revision.pathRestriction !== characterRevision?.path)) exclusions.push({
        code: "light_cone_incompatible", characterId: character.logicalId, logicalId: requestedCone.logicalId,
        message: `${requestedCone.logicalId} 与 ${character.logicalId} 命途不兼容`,
      });
      else if (!owned) exclusions.push({
        code: "light_cone_unavailable", characterId: character.logicalId, logicalId: requestedCone.logicalId,
        message: `${requestedCone.logicalId} 的全部库存实例已被占用`,
      });
      else {
        const superimposition = Math.min(requestedCone.superimposition, owned.superimposition);
        lightCone = { logicalId: owned.logicalId, superimposition };
        usedCones.add(coneInstanceId(owned));
        if (requestedCone.superimposition > owned.superimposition) exclusions.push({
          code: "superimposition_capped", characterId: character.logicalId, logicalId: owned.logicalId,
          requested: requestedCone.superimposition, allocated: superimposition,
          message: `${owned.logicalId} 叠影由 S${requestedCone.superimposition} 限制为库存 S${superimposition}`,
        });
      }
    }
    if (!lightCone) {
      const automatic = ownedCones.find((cone) => {
        const revision = equipmentById.get(cone.logicalId);
        return !usedCones.has(coneInstanceId(cone)) && revision?.kind === "light-cone"
          && (revision.pathRestriction === null || revision.pathRestriction === characterRevision?.path);
      });
      if (automatic) {
        lightCone = { logicalId: automatic.logicalId, superimposition: automatic.superimposition };
        usedCones.add(coneInstanceId(automatic));
      }
    }

    const relicSets: Array<{ logicalId: string; pieces: number }> = [];
    const requestedRelics = new Map<string, number>();
    for (const relic of requested?.relicSets ?? []) {
      requestedRelics.set(relic.logicalId, (requestedRelics.get(relic.logicalId) ?? 0) + relic.pieces);
    }
    for (const [logicalId, requestedPieces] of [...requestedRelics].sort(([left], [right]) => left.localeCompare(right))) {
      const relic = { logicalId, pieces: requestedPieces };
      const revision = equipmentById.get(relic.logicalId);
      const available = remainingRelics.get(relic.logicalId) ?? 0;
      if (revision?.kind !== "relic-set" || !profile.relics.some(({ setLogicalId }) => setLogicalId === relic.logicalId)) {
        exclusions.push({ code: "relic_set_unowned", characterId: character.logicalId, logicalId: relic.logicalId,
          requested: relic.pieces, allocated: 0, message: relic.logicalId + " 不在所选 UID 库存中" });
        continue;
      }
      if (available === 0) {
        exclusions.push({ code: "relic_pieces_capped", characterId: character.logicalId, logicalId: relic.logicalId,
          requested: relic.pieces, allocated: 0, message: relic.logicalId + " 的库存实例已全部分配" });
        continue;
      }
      const pieces = Math.min(relic.pieces, available, 6);
      relicSets.push({ logicalId: relic.logicalId, pieces });
      remainingRelics.set(relic.logicalId, available - pieces);
      if (pieces < relic.pieces) exclusions.push({
        code: "relic_pieces_capped", characterId: character.logicalId, logicalId: relic.logicalId,
        requested: relic.pieces, allocated: pieces,
        message: `${relic.logicalId} 由 ${relic.pieces} 件限制为剩余库存 ${pieces} 件`,
      });
    }
    memberBuilds[character.logicalId] = {
      ...requested,
      eidolon,
      lightCone,
      relicSets: relicSets.length ? relicSets : undefined,
      consumableMetrics: requested?.consumableMetrics ? [...requested.consumableMetrics] : undefined,
    };
  }

  const automaticallyAssignable = characters.filter((character) => !(configured?.[character.logicalId]?.relicSets?.length));
  let cursor = 0;
  for (const [logicalId, available] of [...remainingRelics].sort(([left], [right]) => left.localeCompare(right))) {
    if (equipmentById.get(logicalId)?.kind !== "relic-set") continue;
    let remaining = available;
    while (remaining > 0 && automaticallyAssignable.length) {
      let selectedIndex = -1;
      for (let offset = 0; offset < automaticallyAssignable.length; offset += 1) {
        const index = (cursor + offset) % automaticallyAssignable.length;
        const candidate = automaticallyAssignable[index]!;
        const existing = memberBuilds[candidate.logicalId]?.relicSets ?? [];
        if (existing.length < 3 && !existing.some((item) => item.logicalId === logicalId)) {
          selectedIndex = index;
          break;
        }
      }
      if (selectedIndex < 0) break;
      const character = automaticallyAssignable[selectedIndex]!;
      cursor = (selectedIndex + 1) % automaticallyAssignable.length;
      const build = memberBuilds[character.logicalId]!;
      const existing = build.relicSets ?? [];
      const pieces = Math.min(6, remaining);
      build.relicSets = [...existing, { logicalId, pieces }];
      remaining -= pieces;
    }
    remainingRelics.set(logicalId, remaining);
  }

  exclusions.sort((left, right) => `${left.characterId}:${left.code}:${left.logicalId ?? ""}`
    .localeCompare(`${right.characterId}:${right.code}:${right.logicalId ?? ""}`));
  return { memberBuilds, exclusions };
}
