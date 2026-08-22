import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { AccountProfile } from "../domain/profiles";
import { migrateStoredProfile, validateCurrentProfile } from "./profileJson";

export const PROFILE_DATABASE_VERSION = 2;
const PROFILE_DATABASE_NAME = "star-rail-wiki";

interface StarRailWikiDb extends DBSchema {
  profiles: {
    key: string;
    value: AccountProfile;
    indexes: { "by-updatedAt": string };
  };
}

export interface ProfileStorageIssue { uid: string; message: string }
export interface ProfileListResult { profiles: AccountProfile[]; issues: ProfileStorageIssue[] }

export class ProfileConflictError extends Error {
  constructor(message: string) { super(message); this.name = "ProfileConflictError"; }
}

export interface ProfileDatabase {
  list(): Promise<ProfileListResult>;
  get(uid: string): Promise<AccountProfile | null>;
  create(profile: AccountProfile): Promise<AccountProfile>;
  compareAndSwap(uid: string, expectedUpdatedAt: string,
    updater: (current: AccountProfile) => AccountProfile): Promise<AccountProfile>;
  transact(uid: string, updater: (current: AccountProfile | null) => AccountProfile): Promise<AccountProfile>;
  delete(uid: string, expectedUpdatedAt?: string): Promise<void>;
  close(): void;
}

export interface IndexedDbProfileDatabaseOptions {
  name?: string;
  onBlocked?: () => void;
  onBlocking?: () => void;
}

function clone(profile: AccountProfile): AccountProfile { return structuredClone(profile); }
function message(error: unknown): string { return error instanceof Error ? error.message : "invalid stored profile"; }

export function createMemoryProfileDatabase(
  source: Map<string, AccountProfile> | Map<string, unknown> = new Map<string, unknown>(),
): ProfileDatabase {
  const records = source as Map<string, unknown>;
  function read(uid: string): AccountProfile | null {
    const raw = records.get(uid);
    if (raw === undefined) return null;
    const migrated = migrateStoredProfile(raw);
    if (typeof raw === "object" && raw !== null && "schemaVersion" in raw && raw.schemaVersion === 0) {
      records.set(uid, clone(migrated));
    }
    return clone(migrated);
  }
  return {
    async list() {
      const profiles: AccountProfile[] = [];
      const issues: ProfileStorageIssue[] = [];
      for (const uid of [...records.keys()].sort()) {
        try { const profile = read(uid); if (profile) profiles.push(profile); }
        catch (error) { issues.push({ uid, message: message(error) }); }
      }
      return { profiles: profiles.sort((left, right) => left.uid.localeCompare(right.uid)), issues };
    },
    async get(uid) { return read(uid); },
    async create(profile) {
      const parsed = validateCurrentProfile(profile);
      if (records.has(parsed.uid)) throw new ProfileConflictError(`profile ${parsed.uid} already exists`);
      records.set(parsed.uid, clone(parsed));
      return clone(parsed);
    },
    async compareAndSwap(uid, expectedUpdatedAt, updater) {
      const current = read(uid);
      if (!current) throw new ProfileConflictError(`profile ${uid} no longer exists`);
      if (current.updatedAt !== expectedUpdatedAt) throw new ProfileConflictError(`stale profile conflict for ${uid}`);
      const next = validateCurrentProfile(updater(clone(current)));
      if (next.uid !== uid) throw new Error("transaction UID mismatch");
      if (next.updatedAt === current.updatedAt) throw new ProfileConflictError("updatedAt CAS token must advance");
      records.set(uid, clone(next));
      return clone(next);
    },
    async transact(uid, updater) {
      const current = read(uid);
      const next = validateCurrentProfile(updater(current));
      if (next.uid !== uid) throw new Error("transaction UID mismatch");
      records.set(uid, clone(next));
      return clone(next);
    },
    async delete(uid, expectedUpdatedAt) {
      const current = read(uid);
      if (expectedUpdatedAt !== undefined && current?.updatedAt !== expectedUpdatedAt) {
        throw new ProfileConflictError(`stale profile conflict for ${uid}`);
      }
      records.delete(uid);
    },
    close() {},
  };
}

export function createIndexedDbProfileDatabase(
  options: string | IndexedDbProfileDatabaseOptions = {},
): ProfileDatabase {
  const normalized = typeof options === "string" ? { name: options } : options;
  const name = normalized.name ?? PROFILE_DATABASE_NAME;
  let databasePromise: Promise<IDBPDatabase<StarRailWikiDb>> | null = null;
  function database() {
    databasePromise ??= openDB<StarRailWikiDb>(name, PROFILE_DATABASE_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const store = db.createObjectStore("profiles", { keyPath: "uid" });
          store.createIndex("by-updatedAt", "updatedAt");
        }
      },
      blocked() { normalized.onBlocked?.(); },
      blocking(_currentVersion, _blockedVersion, event) {
        normalized.onBlocking?.();
        (event.target as IDBDatabase).close();
        databasePromise = null;
      },
    });
    return databasePromise;
  }
  return {
    async list() {
      const transaction = (await database()).transaction("profiles", "readwrite");
      const values = await transaction.store.getAll();
      const profiles: AccountProfile[] = [];
      const issues: ProfileStorageIssue[] = [];
      for (const [index, raw] of values.entries()) {
        const uid = typeof raw === "object" && raw !== null && "uid" in raw && typeof raw.uid === "string"
          ? raw.uid : `record:${index}`;
        try {
          const migrated = migrateStoredProfile(raw);
          profiles.push(migrated);
          if (typeof raw === "object" && raw !== null && "schemaVersion" in raw && raw.schemaVersion === 0) {
            await transaction.store.put(migrated);
          }
        } catch (error) { issues.push({ uid, message: message(error) }); }
      }
      await transaction.done;
      return { profiles: profiles.sort((left, right) => left.uid.localeCompare(right.uid)), issues };
    },
    async get(uid) {
      const transaction = (await database()).transaction("profiles", "readwrite");
      const raw = await transaction.store.get(uid);
      if (raw === undefined) { await transaction.done; return null; }
      const migrated = migrateStoredProfile(raw);
      if (typeof raw === "object" && raw !== null && "schemaVersion" in raw && raw.schemaVersion === 0) {
        await transaction.store.put(migrated);
      }
      await transaction.done;
      return migrated;
    },
    async create(profile) {
      const parsed = validateCurrentProfile(profile);
      const transaction = (await database()).transaction("profiles", "readwrite");
      if (await transaction.store.get(parsed.uid)) {
        transaction.abort();
        throw new ProfileConflictError(`profile ${parsed.uid} already exists`);
      }
      await transaction.store.add(parsed);
      await transaction.done;
      return parsed;
    },
    async compareAndSwap(uid, expectedUpdatedAt, updater) {
      const transaction = (await database()).transaction("profiles", "readwrite");
      try {
        const raw = await transaction.store.get(uid);
        if (!raw) throw new ProfileConflictError(`profile ${uid} no longer exists`);
        const current = migrateStoredProfile(raw);
        if (current.updatedAt !== expectedUpdatedAt) throw new ProfileConflictError(`stale profile conflict for ${uid}`);
        const next = validateCurrentProfile(updater(clone(current)));
        if (next.uid !== uid) throw new Error("transaction UID mismatch");
        if (next.updatedAt === current.updatedAt) throw new ProfileConflictError("updatedAt CAS token must advance");
        await transaction.store.put(next);
        await transaction.done;
        return next;
      } catch (error) {
        try { transaction.abort(); } catch { /* transaction may already be inactive */ }
        throw error;
      }
    },
    async transact(uid, updater) {
      const transaction = (await database()).transaction("profiles", "readwrite");
      try {
        const raw = await transaction.store.get(uid);
        const next = validateCurrentProfile(updater(raw === undefined ? null : migrateStoredProfile(raw)));
        if (next.uid !== uid) throw new Error("transaction UID mismatch");
        await transaction.store.put(next);
        await transaction.done;
        return next;
      } catch (error) {
        try { transaction.abort(); } catch { /* transaction may already be inactive */ }
        throw error;
      }
    },
    async delete(uid, expectedUpdatedAt) {
      const transaction = (await database()).transaction("profiles", "readwrite");
      const raw = await transaction.store.get(uid);
      if (expectedUpdatedAt !== undefined && (raw === undefined || migrateStoredProfile(raw).updatedAt !== expectedUpdatedAt)) {
        transaction.abort();
        throw new ProfileConflictError(`stale profile conflict for ${uid}`);
      }
      await transaction.store.delete(uid);
      await transaction.done;
    },
    close() {
      if (databasePromise) void databasePromise.then((db) => db.close());
      databasePromise = null;
    },
  };
}
