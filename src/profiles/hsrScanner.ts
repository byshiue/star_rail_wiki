import { z } from "zod";
import type { AccountProfile } from "../domain/profiles";
import { CURRENT_PROFILE_SCHEMA_VERSION, validateCurrentProfile } from "./profileJson";

const CharacterSchema = z.object({
  id: z.string().min(1), level: z.number().int().positive(), eidolon: z.number().int().min(0).max(6),
}).passthrough();
const LightConeSchema = z.object({
  id: z.string().min(1), level: z.number().int().positive(),
  superimposition: z.number().int().min(1).max(5), _uid: z.string().min(1),
}).passthrough();
const RelicSchema = z.object({
  set_id: z.string().min(1), slot: z.string().min(1), _uid: z.string().min(1),
}).passthrough();
const HsrScannerSchema = z.strictObject({
  source: z.literal("HSR-Scanner"), build: z.string().min(1), version: z.literal(4),
  metadata: z.object({ uid: z.union([z.string().regex(/^\d{9}$/), z.null()]) }).passthrough(),
  characters: z.array(CharacterSchema), light_cones: z.array(LightConeSchema), relics: z.array(RelicSchema),
});

export interface HsrScannerConversionOptions {
  uid: string;
  dataReleaseId: string;
  importedAt?: string;
}

export function convertHsrScannerJson(json: string, options: HsrScannerConversionOptions): AccountProfile {
  let value: unknown;
  try { value = JSON.parse(json); }
  catch { throw new Error("HSR-Scanner JSON is malformed"); }
  const scan = HsrScannerSchema.parse(value);
  if (!/^\d{9}$/.test(options.uid)) throw new Error("An explicit nine-digit target UID is required");
  if (scan.metadata.uid !== null && scan.metadata.uid !== options.uid) {
    throw new Error("HSR-Scanner UID must match the explicit target UID");
  }
  const importedAt = options.importedAt ?? new Date().toISOString();
  return validateCurrentProfile({
    schemaVersion: CURRENT_PROFILE_SCHEMA_VERSION,
    uid: options.uid,
    dataReleaseId: options.dataReleaseId,
    updatedAt: importedAt,
    characters: scan.characters.map(({ id, eidolon, level }) => ({
      logicalId: `character:${id}`, eidolon, level,
    })),
    lightCones: scan.light_cones.map(({ id, _uid, superimposition, level }) => ({
      instanceId: `hsr-scanner:light-cone:${_uid}`,
      logicalId: `light-cone:${id}`, superimposition, level,
    })),
    relics: scan.relics.map(({ set_id, slot, _uid }) => ({
      instanceId: `hsr-scanner:relic:${_uid}`, setLogicalId: `relic-set:${set_id}`, slot,
    })),
    inventorySources: [{
      kind: "hsr-scanner", build: scan.build, formatVersion: scan.version, importedAt,
      counts: {
        characters: scan.characters.length, lightCones: scan.light_cones.length, relics: scan.relics.length,
      },
    }],
  });
}
