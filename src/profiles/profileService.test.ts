import { describe, expect, it } from "vitest";
import type { AccountProfile } from "../domain/profiles";
import { createMemoryProfileDatabase } from "./profileDatabase";
import { CURRENT_PROFILE_SCHEMA_VERSION, migrateStoredProfile } from "./profileJson";
import { createProfileService } from "./profileService";

function profile(uid: string, characterId = "character:a"): AccountProfile {
  return {
    schemaVersion: CURRENT_PROFILE_SCHEMA_VERSION,
    uid,
    label: `账号 ${uid}`,
    dataReleaseId: "4.3-fixture",
    updatedAt: "2026-08-21T00:00:00.000Z",
    characters: [{ logicalId: characterId, eidolon: 1, level: 70 }],
    lightCones: [{ logicalId: "light-cone:a", superimposition: 2, level: 70 }],
    relics: [{ instanceId: `${uid}:relic:1`, setLogicalId: "relic-set:a", slot: "head" }],
  };
}

describe("profile service", () => {
  it("keeps two UID inventories isolated across a database reopen", async () => {
    const records = new Map<string, AccountProfile>();
    const first = createProfileService(createMemoryProfileDatabase(records));
    await first.putProfile(profile("100000001", "character:a"));
    await first.putProfile(profile("100000002", "character:b"));

    const reopened = createProfileService(createMemoryProfileDatabase(records));
    expect((await reopened.getProfile("100000001"))?.characters).toEqual([
      { logicalId: "character:a", eidolon: 1, level: 70 },
    ]);
    expect((await reopened.getProfile("100000002"))?.characters[0]?.logicalId).toBe("character:b");
  });

  it("migrates the explicitly versioned legacy record before validation", () => {
    const legacy = { ...profile("100000001"), schemaVersion: 0 };
    expect(migrateStoredProfile(legacy).schemaVersion).toBe(CURRENT_PROFILE_SCHEMA_VERSION);
  });

  it("validates UID and the complete runtime schema before every write", async () => {
    const service = createProfileService(createMemoryProfileDatabase());
    await expect(service.putProfile({ ...profile("100000001"), uid: "100000001x" }))
      .rejects.toThrow(/uid/i);
    await expect(service.putProfile({ ...profile("100000001"), characters: [
      { logicalId: "character:a", eidolon: 7, level: 70 },
    ] })).rejects.toThrow();
    expect(await service.listProfiles()).toEqual([]);
  });

  it("rejects duplicate inventory IDs before writing", async () => {
    const service = createProfileService(createMemoryProfileDatabase());
    const duplicate = profile("100000001");
    duplicate.characters.push({ ...duplicate.characters[0]! });
    await expect(service.putProfile(duplicate)).rejects.toThrow(/duplicate/i);
    expect(await service.listProfiles()).toEqual([]);
  });

  it("exports deterministic sorted JSON with version provenance", async () => {
    const service = createProfileService(createMemoryProfileDatabase());
    await service.putProfile({
      ...profile("100000001"),
      characters: [
        { logicalId: "character:z", eidolon: 0, level: 1 },
        { logicalId: "character:a", eidolon: 2, level: 80 },
      ],
      relics: [
        { instanceId: "relic:z", setLogicalId: "relic-set:z", slot: "body" },
        { instanceId: "relic:a", setLogicalId: "relic-set:a", slot: "head" },
      ],
    });

    const json = await service.exportProfile("100000001");
    expect(JSON.parse(json)).toMatchObject({
      schemaVersion: CURRENT_PROFILE_SCHEMA_VERSION,
      releaseId: "4.3-fixture",
      updatedAt: "2026-08-21T00:00:00.000Z",
      profile: { uid: "100000001" },
    });
    expect(JSON.parse(json).profile.characters.map((item: { logicalId: string }) => item.logicalId))
      .toEqual(["character:a", "character:z"]);
    expect(json).toBe(await service.exportProfile("100000001"));
  });

  it("does not mutate storage when imported JSON is malformed", async () => {
    const service = createProfileService(createMemoryProfileDatabase());
    await service.putProfile(profile("100000001"));
    const before = await service.listProfiles();
    await expect(service.importProfile("{bad json", "replace")).rejects.toThrow();
    expect(await service.listProfiles()).toEqual(before);
  });

  it("requires an explicit conflict strategy and merges investments deterministically", async () => {
    const service = createProfileService(createMemoryProfileDatabase());
    await service.putProfile(profile("100000001"));
    const incoming: AccountProfile = {
      ...profile("100000001"),
      updatedAt: "2026-08-21T01:00:00.000Z",
      characters: [{ logicalId: "character:a", eidolon: 4, level: 80 }],
      lightCones: [{ logicalId: "light-cone:a", superimposition: 1, level: 80 }],
      relics: [{ instanceId: "relic:new", setLogicalId: "relic-set:b", slot: "feet" }],
    };
    const incomingJson = JSON.stringify({
      schemaVersion: CURRENT_PROFILE_SCHEMA_VERSION,
      releaseId: incoming.dataReleaseId,
      updatedAt: incoming.updatedAt,
      profile: incoming,
    });

    await expect(service.importProfile(incomingJson, undefined)).rejects.toThrow(/merge|replace/i);
    await service.importProfile(incomingJson, "merge");
    const merged = await service.getProfile("100000001");
    expect(merged?.characters[0]).toEqual({ logicalId: "character:a", eidolon: 4, level: 80 });
    expect(merged?.lightCones[0]).toEqual({ logicalId: "light-cone:a", superimposition: 2, level: 80 });
    expect(merged?.relics.map(({ instanceId }) => instanceId)).toEqual(["100000001:relic:1", "relic:new"]);
  });

  it("never overwrites another UID and requires an exact UID deletion confirmation", async () => {
    const service = createProfileService(createMemoryProfileDatabase());
    await service.putProfile(profile("100000001", "character:a"));
    const second = profile("100000002", "character:b");
    await service.importProfile(JSON.stringify({
      schemaVersion: CURRENT_PROFILE_SCHEMA_VERSION,
      releaseId: second.dataReleaseId,
      updatedAt: second.updatedAt,
      profile: second,
    }), "replace");
    expect((await service.getProfile("100000001"))?.characters[0]?.logicalId).toBe("character:a");
    await expect(service.deleteProfile("100000001", "100000002")).rejects.toThrow(/confirmation/i);
    expect(await service.getProfile("100000001")).not.toBeNull();
    await service.deleteProfile("100000001", "100000001");
    expect(await service.getProfile("100000001")).toBeNull();
  });
});
