import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { AccountProfile } from "../domain/profiles";
import { migrateStoredProfile, validateCurrentProfile } from "./profileJson";

export const PROFILE_DATABASE_VERSION = 1;
const PROFILE_DATABASE_NAME = "star-rail-wiki";

interface StarRailWikiDb extends DBSchema {
  profiles: {
    key: string;
    value: AccountProfile;
    indexes: { "by-updatedAt": string };
  };
}

export interface ProfileDatabase {
  list(): Promise<AccountProfile[]>;
  get(uid: string): Promise<AccountProfile | null>;
  put(profile: AccountProfile): Promise<void>;
  delete(uid: string): Promise<void>;
  update(uid: string, updater: (current: AccountProfile | null) => AccountProfile): Promise<AccountProfile>;
  close(): void;
}

function clone(profile: AccountProfile): AccountProfile {
  return structuredClone(profile);
}

export function createMemoryProfileDatabase(
  records: Map<string, AccountProfile> = new Map(),
): ProfileDatabase {
  return {
    async list() {
      return [...records.values()].map(migrateStoredProfile).map(clone)
        .sort((left, right) => left.uid.localeCompare(right.uid));
    },
    async get(uid) {
      const value = records.get(uid);
      return value === undefined ? null : clone(migrateStoredProfile(value));
    },
    async put(profile) {
      const parsed = validateCurrentProfile(profile);
      records.set(parsed.uid, clone(parsed));
    },
    async delete(uid) { records.delete(uid); },
    async update(uid, updater) {
      const current = records.get(uid);
      const next = validateCurrentProfile(updater(current === undefined ? null : clone(migrateStoredProfile(current))));
      if (next.uid !== uid) throw new Error("transaction UID mismatch");
      records.set(uid, clone(next));
      return clone(next);
    },
    close() {},
  };
}

export function createIndexedDbProfileDatabase(
  name = PROFILE_DATABASE_NAME,
): ProfileDatabase {
  let databasePromise: Promise<IDBPDatabase<StarRailWikiDb>> | null = null;
  function database() {
    databasePromise ??= openDB<StarRailWikiDb>(name, PROFILE_DATABASE_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const store = db.createObjectStore("profiles", { keyPath: "uid" });
          store.createIndex("by-updatedAt", "updatedAt");
        }
      },
    });
    return databasePromise;
  }
  return {
    async list() {
      return (await (await database()).getAll("profiles")).map(migrateStoredProfile)
        .sort((left, right) => left.uid.localeCompare(right.uid));
    },
    async get(uid) {
      const value = await (await database()).get("profiles", uid);
      return value === undefined ? null : migrateStoredProfile(value);
    },
    async put(profile) {
      const parsed = validateCurrentProfile(profile);
      await (await database()).put("profiles", parsed);
    },
    async delete(uid) { await (await database()).delete("profiles", uid); },
    async update(uid, updater) {
      const transaction = (await database()).transaction("profiles", "readwrite");
      try {
        const current = await transaction.store.get(uid);
        const next = validateCurrentProfile(updater(current === undefined ? null : migrateStoredProfile(current)));
        if (next.uid !== uid) throw new Error("transaction UID mismatch");
        await transaction.store.put(next);
        await transaction.done;
        return next;
      } catch (error) {
        try { transaction.abort(); } catch { /* Transaction may already be inactive after a request failure. */ }
        throw error;
      }
    },
    close() {
      if (databasePromise) void databasePromise.then((db) => db.close());
      databasePromise = null;
    },
  };
}
