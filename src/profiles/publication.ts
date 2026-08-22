import { z } from "zod";
import type { AccountProfile } from "../domain/profiles";

export const PUBLIC_PROFILE_SCHEMA_VERSION = 1;
export const PUBLIC_PROFILE_INDEX_SCHEMA_VERSION = 1;
export const MAX_CONSENT_FUTURE_SKEW_MS = 5 * 60 * 1000;

export const PublicAccountProfileSchema = z.strictObject({
  schemaVersion: z.literal(PUBLIC_PROFILE_SCHEMA_VERSION), uid: z.string().regex(/^\d{9}$/),
  releaseId: z.string().min(1), updatedAt: z.iso.datetime(),
  publication: z.strictObject({ visibility: z.literal("public"), consentedAt: z.iso.datetime() }),
  characters: z.array(z.strictObject({ logicalId: z.string().min(1), eidolon: z.number().int().min(0).max(6), level: z.number().int().positive() })),
  lightCones: z.array(z.strictObject({ logicalId: z.string().min(1), superimposition: z.number().int().min(1).max(5), level: z.number().int().positive() })),
  relics: z.array(z.strictObject({ setLogicalId: z.string().min(1), slot: z.string().min(1) })),
}).superRefine((profile, context) => {
  const updatedAt = Date.parse(profile.updatedAt);
  const consentedAt = Date.parse(profile.publication.consentedAt);
  if (consentedAt < updatedAt) context.addIssue({ code: "custom", path: ["publication", "consentedAt"], message: "publication consent must not precede updatedAt" });
});
export type PublicAccountProfile = z.infer<typeof PublicAccountProfileSchema>;

export const PublicProfileIndexSchema = z.strictObject({
  schemaVersion: z.literal(PUBLIC_PROFILE_INDEX_SCHEMA_VERSION),
  profiles: z.array(z.strictObject({ uid: z.string().regex(/^\d{9}$/), path: z.string().regex(/^\d{9}\.json$/), updatedAt: z.iso.datetime() })),
});

export class PublicProfileNotFoundError extends Error {
  constructor(uid: string) { super(`No merged public profile exists for UID ${uid}`); }
}

function stable(profile: PublicAccountProfile): PublicAccountProfile {
  return { ...profile,
    characters: [...profile.characters].map((item) => ({ ...item })).sort((a, b) => a.logicalId.localeCompare(b.logicalId)),
    lightCones: [...profile.lightCones].map((item) => ({ ...item })).sort((a, b) => a.logicalId.localeCompare(b.logicalId)),
    relics: [...profile.relics].map((item) => ({ ...item })).sort((a, b) => `${a.setLogicalId}:${a.slot}`.localeCompare(`${b.setLogicalId}:${b.slot}`)),
  };
}

export function isConsentTimestampTooFarInFuture(consentedAt: string, nowMs = Date.now()): boolean {
  return Date.parse(consentedAt) > nowMs + MAX_CONSENT_FUTURE_SKEW_MS;
}

export function createPublicProfileExport(profile: AccountProfile, consentAt: string | null): PublicAccountProfile {
  if (consentAt === null) throw new Error("Public consent required before creating a publication artifact");
  if (isConsentTimestampTooFarInFuture(consentAt)) throw new Error("Publication consent cannot be in the future");
  return stable(PublicAccountProfileSchema.parse({ schemaVersion: PUBLIC_PROFILE_SCHEMA_VERSION, uid: profile.uid,
    releaseId: profile.dataReleaseId, updatedAt: profile.updatedAt,
    publication: { visibility: "public", consentedAt: consentAt },
    characters: profile.characters.map(({ logicalId, eidolon, level }) => ({ logicalId, eidolon, level })),
    lightCones: profile.lightCones.map(({ logicalId, superimposition, level }) => ({ logicalId, superimposition, level })),
    relics: profile.relics.map(({ setLogicalId, slot }) => ({ setLogicalId, slot })),
  }));
}

export function publicProfilePath(uid: string): string {
  if (!/^\d{9}$/.test(uid)) throw new Error("Invalid public profile UID");
  return `profiles/${uid}.json`;
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to load public profile data (${response.status})`);
  return response.json() as Promise<unknown>;
}

export async function loadPublicProfile(uid: string): Promise<PublicAccountProfile> {
  const profilePath = publicProfilePath(uid);
  const base = import.meta.env.BASE_URL;
  const index = PublicProfileIndexSchema.parse(await fetchJson(`${base}profiles/index.json`));
  const entries = index.profiles.filter((entry) => entry.uid === uid);
  if (!entries.length) throw new PublicProfileNotFoundError(uid);
  if (entries.length !== 1) throw new Error(`Public profile index contains duplicate UID ${uid}`);
  const entry = entries[0]!;
  if (entry.path !== `${uid}.json`) throw new Error(`Public profile index path does not match requested UID ${uid}`);
  const profile = PublicAccountProfileSchema.parse(await fetchJson(`${base}${profilePath}`));
  if (profile.uid !== uid) throw new Error(`Public profile body does not match requested UID ${uid}`);
  if (profile.updatedAt !== entry.updatedAt) throw new Error(`Public profile index timestamp does not match UID ${uid}`);
  return stable(profile);
}
