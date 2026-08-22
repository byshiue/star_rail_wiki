import { z } from "zod";
import type { AccountProfile, OwnedCharacter, OwnedLightCone, OwnedRelic } from "../domain/profiles";
import { createIndexedDbProfileDatabase, type ProfileDatabase } from "./profileDatabase";
import { parseProfileExport, serializeProfile, validateCurrentProfile } from "./profileJson";

const UidSchema = z.string().regex(/^\d{9}$/, "UID must contain exactly 9 digits");
export type ImportStrategy = "merge" | "replace";

export interface ProfileService {
  listProfiles(): Promise<AccountProfile[]>;
  getProfile(uid: string): Promise<AccountProfile | null>;
  putProfile(profile: AccountProfile): Promise<AccountProfile>;
  deleteProfile(uid: string, confirmationUid?: string): Promise<void>;
  exportProfile(uid: string): Promise<string>;
  importProfile(json: string, strategy?: ImportStrategy): Promise<AccountProfile>;
  close(): void;
}

function uid(value: string): string {
  return UidSchema.parse(value);
}

function mergeById<T>(
  current: readonly T[], incoming: readonly T[], id: (item: T) => string,
  merge: (left: T, right: T) => T,
): T[] {
  const values = new Map(current.map((item) => [id(item), structuredClone(item)]));
  for (const item of incoming) {
    const existing = values.get(id(item));
    values.set(id(item), existing === undefined ? structuredClone(item) : merge(existing, item));
  }
  return [...values.values()].sort((left, right) => id(left).localeCompare(id(right)));
}

function mergeProfiles(current: AccountProfile, incoming: AccountProfile): AccountProfile {
  if (current.uid !== incoming.uid) throw new Error("cannot merge profiles across UIDs");
  if (current.dataReleaseId !== incoming.dataReleaseId) {
    throw new Error("cannot merge profiles from different releases; choose replace explicitly");
  }
  const characters = mergeById<OwnedCharacter>(current.characters, incoming.characters, (item) => item.logicalId,
    (left, right) => ({ ...left, eidolon: Math.max(left.eidolon, right.eidolon), level: Math.max(left.level, right.level) }));
  const lightCones = mergeById<OwnedLightCone>(current.lightCones, incoming.lightCones, (item) => item.logicalId,
    (left, right) => ({ ...left, superimposition: Math.max(left.superimposition, right.superimposition), level: Math.max(left.level, right.level) }));
  const relics = mergeById<OwnedRelic>(current.relics, incoming.relics, (item) => item.instanceId,
    (_left, right) => ({ ...right }));
  return validateCurrentProfile({
    ...current,
    label: incoming.label ?? current.label,
    region: incoming.region ?? current.region,
    updatedAt: current.updatedAt > incoming.updatedAt ? current.updatedAt : incoming.updatedAt,
    characters, lightCones, relics,
    publication: incoming.publication ?? current.publication,
  });
}

export function createProfileService(database: ProfileDatabase): ProfileService {
  return {
    async listProfiles() { return database.list(); },
    async getProfile(rawUid) { return database.get(uid(rawUid)); },
    async putProfile(profile) {
      const parsed = validateCurrentProfile(profile);
      await database.put(parsed);
      return parsed;
    },
    async deleteProfile(rawUid, confirmationUid) {
      const parsedUid = uid(rawUid);
      if (confirmationUid !== parsedUid) throw new Error("exact UID confirmation is required for deletion");
      await database.delete(parsedUid);
    },
    async exportProfile(rawUid) {
      const profile = await database.get(uid(rawUid));
      if (!profile) throw new Error("profile not found");
      return serializeProfile(profile);
    },
    async importProfile(json, strategy) {
      const incoming = parseProfileExport(json);
      const importedUid = uid(incoming.uid);
      return database.update(importedUid, (current) => {
        if (current === null) return incoming;
        if (strategy !== "merge" && strategy !== "replace") {
          throw new Error("existing profile requires an explicit merge or replace strategy");
        }
        return strategy === "merge" ? mergeProfiles(current, incoming) : incoming;
      });
    },
    close() { database.close(); },
  };
}

export const defaultProfileService = createProfileService(createIndexedDbProfileDatabase());
