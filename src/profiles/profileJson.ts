import { z } from "zod";
import {
  AccountProfileSchema, OwnedCharacterSchema, OwnedLightConeSchema, OwnedRelicSchema,
  type AccountProfile,
} from "../domain/profiles";

export const CURRENT_PROFILE_SCHEMA_VERSION = 1;

const LegacyAccountProfileV0CurrentFieldsSchema = AccountProfileSchema.extend({ schemaVersion: z.literal(0) });
const LegacyAccountProfileV0RenamedFieldsSchema = z.strictObject({
  schemaVersion: z.literal(0), uid: z.string().regex(/^\d{9}$/),
  displayName: z.string().min(1).optional(),
  region: z.enum(["cn", "asia", "america", "europe", "tw_hk_mo"]).optional(),
  releaseId: z.string().min(1), updatedAt: z.iso.datetime(),
  characters: z.array(OwnedCharacterSchema), lightCones: z.array(OwnedLightConeSchema),
  relics: z.array(OwnedRelicSchema),
});
export const LegacyAccountProfileV0Schema = z.union([
  LegacyAccountProfileV0CurrentFieldsSchema, LegacyAccountProfileV0RenamedFieldsSchema,
]);

const CurrentAccountProfileSchema = AccountProfileSchema.superRefine((profile, context) => {
  if (profile.schemaVersion !== CURRENT_PROFILE_SCHEMA_VERSION) context.addIssue({
    code: "custom", path: ["schemaVersion"],
    message: "unsupported profile schemaVersion: " + profile.schemaVersion,
  });
  const inventories = [
    ["characters", profile.characters.map(({ logicalId }) => logicalId)],
    ["lightCones", profile.lightCones.map(({ logicalId }) => logicalId)],
    ["relics", profile.relics.map(({ instanceId }) => instanceId)],
  ] as const;
  for (const [field, ids] of inventories) {
    const seen = new Set<string>();
    ids.forEach((id, index) => {
      if (seen.has(id)) context.addIssue({
        code: "custom", path: [field, index], message: "duplicate " + field + " inventory ID: " + id,
      });
      seen.add(id);
    });
  }
});

export const ProfileExportSchema = z.strictObject({
  schemaVersion: z.literal(CURRENT_PROFILE_SCHEMA_VERSION),
  releaseId: z.string().min(1),
  updatedAt: z.iso.datetime(),
  profile: CurrentAccountProfileSchema,
}).superRefine((document, context) => {
  if (document.releaseId !== document.profile.dataReleaseId) context.addIssue({
    code: "custom", path: ["releaseId"], message: "export releaseId does not match profile dataReleaseId",
  });
  if (document.updatedAt !== document.profile.updatedAt) context.addIssue({
    code: "custom", path: ["updatedAt"], message: "export updatedAt does not match profile updatedAt",
  });
});

export type ProfileExport = z.infer<typeof ProfileExportSchema>;

function stableProfile(profile: AccountProfile): AccountProfile {
  return {
    schemaVersion: profile.schemaVersion,
    uid: profile.uid,
    ...(profile.label === undefined ? {} : { label: profile.label }),
    ...(profile.region === undefined ? {} : { region: profile.region }),
    dataReleaseId: profile.dataReleaseId,
    updatedAt: profile.updatedAt,
    characters: [...profile.characters].map((item) => ({ ...item }))
      .sort((left, right) => left.logicalId.localeCompare(right.logicalId)),
    lightCones: [...profile.lightCones].map((item) => ({ ...item }))
      .sort((left, right) => left.logicalId.localeCompare(right.logicalId)),
    relics: [...profile.relics].map((item) => ({ ...item }))
      .sort((left, right) => left.instanceId.localeCompare(right.instanceId)),
    ...(profile.publication === undefined ? {} : { publication: { ...profile.publication } }),
  };
}

export function validateCurrentProfile(value: unknown): AccountProfile {
  return stableProfile(CurrentAccountProfileSchema.parse(value));
}

export function migrateStoredProfile(value: unknown): AccountProfile {
  if (typeof value === "object" && value !== null && "schemaVersion" in value && value.schemaVersion === 0) {
    const legacy = LegacyAccountProfileV0Schema.parse(value);
    if ("dataReleaseId" in legacy) {
      return validateCurrentProfile({ ...legacy, schemaVersion: CURRENT_PROFILE_SCHEMA_VERSION });
    }
    return validateCurrentProfile({
      schemaVersion: CURRENT_PROFILE_SCHEMA_VERSION, uid: legacy.uid,
      ...(legacy.displayName === undefined ? {} : { label: legacy.displayName }),
      ...(legacy.region === undefined ? {} : { region: legacy.region }),
      dataReleaseId: legacy.releaseId, updatedAt: legacy.updatedAt,
      characters: legacy.characters, lightCones: legacy.lightCones, relics: legacy.relics,
    });
  }
  return validateCurrentProfile(value);
}

export function serializeProfile(profile: AccountProfile): string {
  const parsed = validateCurrentProfile(profile);
  return JSON.stringify(ProfileExportSchema.parse({
    schemaVersion: CURRENT_PROFILE_SCHEMA_VERSION,
    releaseId: parsed.dataReleaseId,
    updatedAt: parsed.updatedAt,
    profile: parsed,
  }), null, 2);
}

export function parseProfileExport(json: string): AccountProfile {
  let value: unknown;
  try { value = JSON.parse(json); }
  catch { throw new Error("Profile JSON is malformed"); }
  return stableProfile(ProfileExportSchema.parse(value).profile);
}
