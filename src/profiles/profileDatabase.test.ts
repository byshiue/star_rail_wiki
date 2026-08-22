import { beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { deleteDB, openDB } from "idb";
import { createIndexedDbProfileDatabase, PROFILE_DATABASE_VERSION } from "./profileDatabase";

const legacy = {
  schemaVersion: 0 as const, uid: "100000001", displayName: "旧档案", releaseId: "4.3-fixture",
  updatedAt: "2026-08-21T00:00:00.000Z", characters: [], lightCones: [], relics: [],
};

beforeEach(() => {
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: new IDBFactory() });
});

describe("IndexedDB profile adapter", () => {
  it("upgrades a real v1 database, writes migrated v0 records back, and isolates bad records", async () => {
    const name = "profile-migration";
    const seed = await openDB(name, 1, { upgrade(db) {
      const store = db.createObjectStore("profiles", { keyPath: "uid" });
      store.createIndex("by-updatedAt", "updatedAt");
    } });
    await seed.put("profiles", legacy);
    await seed.put("profiles", { uid: "100000002", schemaVersion: 99, updatedAt: legacy.updatedAt });
    seed.close();

    const adapter = createIndexedDbProfileDatabase(name);
    const result = await adapter.list();
    expect(result.profiles).toEqual([expect.objectContaining({
      uid: legacy.uid, schemaVersion: 1, label: legacy.displayName, dataReleaseId: legacy.releaseId,
    })]);
    expect(result.issues).toEqual([expect.objectContaining({ uid: "100000002" })]);
    adapter.close();

    const inspect = await openDB(name, PROFILE_DATABASE_VERSION);
    expect(await inspect.get("profiles", legacy.uid)).toEqual(expect.objectContaining({
      schemaVersion: 1, label: legacy.displayName, dataReleaseId: legacy.releaseId,
    }));
    inspect.close();
    await deleteDB(name);
  });

  it("reports blocked upgrades and closes on a later versionchange", async () => {
    const name = "profile-version-events";
    const blocker = await openDB(name, 1, { upgrade(db) {
      const store = db.createObjectStore("profiles", { keyPath: "uid" });
      store.createIndex("by-updatedAt", "updatedAt");
    } });
    const onBlocked = vi.fn();
    const onBlocking = vi.fn();
    const adapter = createIndexedDbProfileDatabase({ name, onBlocked, onBlocking });
    const opening = adapter.list();
    await vi.waitFor(() => expect(onBlocked).toHaveBeenCalledOnce());
    blocker.close();
    await opening;

    const upgrade = openDB(name, PROFILE_DATABASE_VERSION + 1);
    await vi.waitFor(() => expect(onBlocking).toHaveBeenCalledOnce());
    (await upgrade).close();
    await deleteDB(name);
    await expect(adapter.list()).resolves.toEqual({ profiles: [], issues: [] });
    adapter.close();
    await deleteDB(name);
  });
});
