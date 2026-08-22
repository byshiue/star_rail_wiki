import { beforeEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { deleteDB, openDB } from "idb";
import { createIndexedDbProfileDatabase, PROFILE_DATABASE_VERSION } from "./profileDatabase";
import { CURRENT_PROFILE_SCHEMA_VERSION } from "./profileJson";

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
      uid: legacy.uid, schemaVersion: CURRENT_PROFILE_SCHEMA_VERSION,
      label: legacy.displayName, dataReleaseId: legacy.releaseId,
    })]);
    expect(result.issues).toEqual([expect.objectContaining({ uid: "100000002" })]);
    adapter.close();

    const inspect = await openDB(name, PROFILE_DATABASE_VERSION);
    expect(await inspect.get("profiles", legacy.uid)).toEqual(expect.objectContaining({
      schemaVersion: CURRENT_PROFILE_SCHEMA_VERSION, label: legacy.displayName, dataReleaseId: legacy.releaseId,
    }));
    inspect.close();
    await deleteDB(name);
  });

  it("rejects a genuinely blocked open with a structured retryable error", async () => {
    const name = "profile-open-blocked";
    const blocker = await openDB(name, 1, { upgrade(db) {
      const store = db.createObjectStore("profiles", { keyPath: "uid" });
      store.createIndex("by-updatedAt", "updatedAt");
    } });
    const adapter = createIndexedDbProfileDatabase({ name });
    const pending = adapter.list();
    const outcome = await Promise.race([
      pending.then(() => ({ status: "fulfilled" as const }), (error: unknown) => ({ status: "rejected" as const, error })),
      new Promise<{ status: "timeout" }>((resolve) => setTimeout(() => resolve({ status: "timeout" }), 50)),
    ]);
    blocker.close();
    if (outcome.status === "timeout") await pending;
    expect(outcome).toMatchObject({
      status: "rejected", error: { code: "indexeddb_open_blocked", retryable: true },
    });
    adapter.close();
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
    const blockedResult = expect(opening).rejects.toMatchObject({ code: "indexeddb_open_blocked", retryable: true });
    await vi.waitFor(() => expect(onBlocked).toHaveBeenCalledOnce());
    await blockedResult;
    blocker.close();
    await expect(adapter.list()).resolves.toEqual({ profiles: [], issues: [] });

    const upgrade = openDB(name, PROFILE_DATABASE_VERSION + 1);
    await vi.waitFor(() => expect(onBlocking).toHaveBeenCalledOnce());
    (await upgrade).close();
    await deleteDB(name);
    await expect(adapter.list()).resolves.toEqual({ profiles: [], issues: [] });
    adapter.close();
    await deleteDB(name);
  });
});
