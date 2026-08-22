import { describe, expect, it } from "vitest";
import { CURRENT_PROFILE_SCHEMA_VERSION, migrateStoredProfile, validateCurrentProfile } from "./profileJson";
import { createMemoryProfileDatabase } from "./profileDatabase";

describe("profile schema v2", () => {
  it("migrates v1 light cones to stable legacy instance IDs", () => {
    const migrated = migrateStoredProfile({
      schemaVersion: 1, uid: "100000001", dataReleaseId: "4.4-cn-2026-08-21",
      updatedAt: "2026-08-21T00:00:00.000Z", characters: [],
      lightCones: [{ logicalId: "light-cone:20000", superimposition: 2, level: 70 }], relics: [],
    });
    expect(CURRENT_PROFILE_SCHEMA_VERSION).toBe(2);
    expect(migrated.lightCones).toEqual([{
      instanceId: "legacy:light-cone:20000", logicalId: "light-cone:20000",
      superimposition: 2, level: 70,
    }]);
  });

  it("allows duplicate light-cone kinds but rejects duplicate instance IDs", () => {
    const base = {
      schemaVersion: 2, uid: "100000001", dataReleaseId: "4.4-cn-2026-08-21",
      updatedAt: "2026-08-21T00:00:00.000Z", characters: [], relics: [],
    };
    expect(validateCurrentProfile({ ...base, lightCones: [
      { instanceId: "cone:a", logicalId: "light-cone:20000", superimposition: 1, level: 1 },
      { instanceId: "cone:b", logicalId: "light-cone:20000", superimposition: 5, level: 80 },
    ] }).lightCones).toHaveLength(2);
    expect(() => validateCurrentProfile({ ...base, lightCones: [
      { instanceId: "cone:a", logicalId: "light-cone:20000", superimposition: 1, level: 1 },
      { instanceId: "cone:a", logicalId: "light-cone:20001", superimposition: 1, level: 1 },
    ] })).toThrow(/duplicate/i);
  });

  it("persists a migrated v1 record instead of re-migrating it on every read", async () => {
    const legacy = {
      schemaVersion: 1, uid: "100000001", dataReleaseId: "4.4-cn-2026-08-21",
      updatedAt: "2026-08-21T00:00:00.000Z", characters: [],
      lightCones: [{ logicalId: "light-cone:20000", superimposition: 1, level: 1 }], relics: [],
    };
    const records = new Map<string, unknown>([[legacy.uid, legacy]]);
    await createMemoryProfileDatabase(records).get(legacy.uid);
    expect(records.get(legacy.uid)).toMatchObject({ schemaVersion: 2, lightCones: [{
      instanceId: "legacy:light-cone:20000",
    }] });
  });
});
