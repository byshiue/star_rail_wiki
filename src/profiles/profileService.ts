import { z } from "zod";
import type { AccountProfile, OwnedCharacter, OwnedLightCone, OwnedRelic } from "../domain/profiles";
import type { GameReleaseBundle } from "../domain/releases";
import { loadRelease } from "../data/releaseRepository";
import { createIndexedDbProfileDatabase, type IndexedDbProfileDatabaseOptions, type ProfileDatabase, type ProfileStorageIssue } from "./profileDatabase";
import { parseProfileExport, serializeProfile, validateCurrentProfile } from "./profileJson";
import { convertHsrScannerJson, type HsrScannerConversionOptions } from "./hsrScanner";

const UidSchema = z.string().regex(/^\d{9}$/, "UID must contain exactly 9 digits");
export type ImportStrategy = "merge" | "replace";

export interface ProfileService {
  listProfiles(): Promise<AccountProfile[]>;
  listProfileIssues(): Promise<ProfileStorageIssue[]>;
  getProfile(uid: string): Promise<AccountProfile | null>;
  putProfile(profile: AccountProfile): Promise<AccountProfile>;
  updateProfile(uid: string, expectedUpdatedAt: string, updater: (current: AccountProfile) => AccountProfile): Promise<AccountProfile>;
  deleteProfile(uid: string, confirmationUid?: string, expectedUpdatedAt?: string): Promise<void>;
  exportProfile(uid: string): Promise<string>;
  importProfile(json: string, strategy?: ImportStrategy): Promise<AccountProfile>;
  importHsrScanner(json: string, options: HsrScannerConversionOptions): Promise<AccountProfile>;
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

function advancedRevision(...timestamps: string[]): string {
  const latest = Math.max(Date.now(), ...timestamps.map((value) => Date.parse(value) + 1));
  return new Date(latest).toISOString();
}

function mergeProfiles(current: AccountProfile, incoming: AccountProfile): AccountProfile {
  if (current.uid !== incoming.uid) throw new Error("cannot merge profiles across UIDs");
  if (current.dataReleaseId !== incoming.dataReleaseId) {
    throw new Error("cannot merge profiles from different releases; choose replace explicitly");
  }
  const characters = mergeById<OwnedCharacter>(current.characters, incoming.characters, (item) => item.logicalId,
    (left, right) => ({ ...left, eidolon: Math.max(left.eidolon, right.eidolon), level: Math.max(left.level, right.level) }));
  const lightCones = mergeById<OwnedLightCone>(current.lightCones, incoming.lightCones,
    (item) => item.instanceId ?? `legacy:${item.logicalId}`,
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
    inventorySources: [...(current.inventorySources ?? []), ...(incoming.inventorySources ?? [])].slice(-100),
  });
}

export type ProfileReleaseResolver = (releaseId: string) => Promise<GameReleaseBundle>;

function validateProfileReferences(profile: AccountProfile, bundle: GameReleaseBundle): void {
  if (bundle.release.id !== profile.dataReleaseId) throw new Error(`release ${profile.dataReleaseId} was not resolved`);
  const characters = new Set(bundle.entities.characters
    .filter(({ validToReleaseId }) => validToReleaseId === null).map(({ logicalId }) => logicalId));
  const cones = new Set(bundle.entities.equipment
    .filter(({ validToReleaseId, kind }) => validToReleaseId === null && kind === "light-cone")
    .map(({ logicalId }) => logicalId));
  const relicSets = new Set(bundle.entities.equipment
    .filter(({ validToReleaseId, kind }) => validToReleaseId === null && kind === "relic-set")
    .map(({ logicalId }) => logicalId));
  for (const item of profile.characters) if (!characters.has(item.logicalId)) {
    throw new Error(`unknown or inactive character reference: ${item.logicalId}`);
  }
  for (const item of profile.lightCones) if (!cones.has(item.logicalId)) {
    throw new Error(`unknown, inactive, or wrong-kind light cone reference: ${item.logicalId}`);
  }
  for (const item of profile.relics) if (!relicSets.has(item.setLogicalId)) {
    throw new Error(`unknown, inactive, or wrong-kind relic set reference: ${item.setLogicalId}`);
  }
}

export function createProfileService(database: ProfileDatabase, resolveRelease: ProfileReleaseResolver = loadRelease): ProfileService {
  return {
    async listProfiles() { return (await database.list()).profiles; },
    async listProfileIssues() { return (await database.list()).issues; },
    async getProfile(rawUid) { return database.get(uid(rawUid)); },
    async putProfile(profile) {
      const parsed = validateCurrentProfile(profile);
      return database.create(parsed);
    },
    async updateProfile(rawUid, expectedUpdatedAt, updater) {
      const parsedUid = uid(rawUid);
      return database.compareAndSwap(parsedUid, expectedUpdatedAt, (current) => validateCurrentProfile(updater(current)));
    },
    async deleteProfile(rawUid, confirmationUid, expectedUpdatedAt) {
      const parsedUid = uid(rawUid);
      if (confirmationUid !== parsedUid) throw new Error("exact UID confirmation is required for deletion");
      await database.delete(parsedUid, expectedUpdatedAt);
    },
    async exportProfile(rawUid) {
      const profile = await database.get(uid(rawUid));
      if (!profile) throw new Error("profile not found");
      return serializeProfile(profile);
    },
    async importProfile(json, strategy) {
      const incoming = parseProfileExport(json);
      const importedUid = uid(incoming.uid);
      validateProfileReferences(incoming, await resolveRelease(incoming.dataReleaseId));
      return database.transact(importedUid, (current) => {
        if (current === null) return incoming;
        if (strategy !== "merge" && strategy !== "replace") {
          throw new Error("existing profile requires an explicit merge or replace strategy");
        }
        const imported = strategy === "merge" ? mergeProfiles(current, incoming) : incoming;
        return { ...imported, updatedAt: advancedRevision(current.updatedAt, incoming.updatedAt) };
      });
    },
    close() { database.close(); },
    async importHsrScanner(json, options) {
      const targetUid = uid(options.uid);
      const incoming = convertHsrScannerJson(json, { ...options, uid: targetUid });
      validateProfileReferences(incoming, await resolveRelease(incoming.dataReleaseId));
      return database.transact(targetUid, (current) => {
        if (current === null) return incoming;
        if (current.dataReleaseId !== incoming.dataReleaseId) {
          throw new Error("cannot merge HSR-Scanner inventory into a profile from a different release");
        }
        const imported = mergeProfiles(current, incoming);
        return { ...imported, updatedAt: advancedRevision(current.updatedAt, incoming.updatedAt) };
      });
    },
  };
}

export function createDefaultProfileService(options: string | IndexedDbProfileDatabaseOptions = {}): ProfileService {
  return createProfileService(createIndexedDbProfileDatabase(options), loadRelease);
}

export const defaultProfileService = createDefaultProfileService();
