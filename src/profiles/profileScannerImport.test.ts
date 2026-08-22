import { describe, expect, it } from "vitest";
import type { GameReleaseBundle } from "../domain/releases";
import { createMemoryProfileDatabase } from "./profileDatabase";
import { createProfileService } from "./profileService";

const releaseId = "4.4-cn-2026-08-21";
const bundle = {
  release: { id: releaseId },
  entities: {
    characters: [{ logicalId: "character:1001", validToReleaseId: null }],
    equipment: [
      { logicalId: "light-cone:20000", kind: "light-cone", validToReleaseId: null },
      { logicalId: "relic-set:101", kind: "relic-set", validToReleaseId: null },
    ],
  },
} as GameReleaseBundle;

function scan(data: { characters?: unknown[]; light_cones?: unknown[]; relics?: unknown[] }) {
  return JSON.stringify({
    source: "HSR-Scanner", build: "v1.5.0", version: 4,
    metadata: { uid: null, trailblazer: "Stelle" },
    characters: data.characters ?? [], light_cones: data.light_cones ?? [], relics: data.relics ?? [],
  });
}

const character = { id: "1001", level: 80, eidolon: 2 };
const cones = [
  { id: "20000", level: 80, superimposition: 5, _uid: "cone-a" },
  { id: "20000", level: 70, superimposition: 1, _uid: "cone-b" },
];
const relic = { set_id: "101", slot: "Head", _uid: "relic-a" };

describe("profile service HSR-Scanner import", () => {
  it("atomically merges complementary partial scans and preserves duplicate cone kinds", async () => {
    const service = createProfileService(createMemoryProfileDatabase(), async () => bundle);
    await service.importHsrScanner(scan({ characters: [character] }), {
      uid: "100000001", dataReleaseId: releaseId, importedAt: "2026-08-22T00:00:00.000Z",
    });
    await service.importHsrScanner(scan({ light_cones: cones, relics: [relic] }), {
      uid: "100000001", dataReleaseId: releaseId, importedAt: "2026-08-22T00:01:00.000Z",
    });

    const profile = await service.getProfile("100000001");
    expect(profile?.characters).toHaveLength(1);
    expect(profile?.lightCones.map(({ instanceId }) => instanceId)).toEqual([
      "hsr-scanner:light-cone:cone-a", "hsr-scanner:light-cone:cone-b",
    ]);
    expect(profile?.relics).toHaveLength(1);
    expect(profile?.inventorySources).toHaveLength(2);
  });

  it("is idempotent for inventory instances when the same scan is imported again", async () => {
    const service = createProfileService(createMemoryProfileDatabase(), async () => bundle);
    const json = scan({ light_cones: cones, relics: [relic] });
    await service.importHsrScanner(json, {
      uid: "100000001", dataReleaseId: releaseId, importedAt: "2026-08-22T00:00:00.000Z",
    });
    await service.importHsrScanner(json, {
      uid: "100000001", dataReleaseId: releaseId, importedAt: "2026-08-22T00:01:00.000Z",
    });
    const profile = await service.getProfile("100000001");
    expect(profile?.lightCones).toHaveLength(2);
    expect(profile?.relics).toHaveLength(1);
  });

  it("rejects unknown references and release mismatches without mutating storage", async () => {
    const service = createProfileService(createMemoryProfileDatabase(), async () => bundle);
    await expect(service.importHsrScanner(scan({ characters: [{ id: "missing", level: 1, eidolon: 0 }] }), {
      uid: "100000001", dataReleaseId: releaseId,
    })).rejects.toThrow(/unknown.*character/i);
    expect(await service.listProfiles()).toEqual([]);

    await service.importHsrScanner(scan({ characters: [character] }), {
      uid: "100000001", dataReleaseId: releaseId,
    });
    const before = await service.getProfile("100000001");
    await expect(service.importHsrScanner(scan({ light_cones: cones }), {
      uid: "100000001", dataReleaseId: "other-release",
    })).rejects.toThrow(/release/i);
    expect(await service.getProfile("100000001")).toEqual(before);
  });
});
