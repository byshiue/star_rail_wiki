import { z } from "zod";
import type { AccountProfile } from "../domain/profiles";
import { CURRENT_PROFILE_SCHEMA_VERSION, validateCurrentProfile } from "./profileJson";

const MAX_SCANNER_STRING_LENGTH = 256;
const ScannerStringSchema = z.string().min(1).max(MAX_SCANNER_STRING_LENGTH);
const ScannerUidSchema = z.union([
  z.string().regex(/^\d{9}$/),
  z.number().int().min(100_000_000).max(999_999_999),
  z.null(),
]).transform((value) => value === null ? null : String(value));

const CharacterSchema = z.object({
  id: ScannerStringSchema, level: z.number().int().positive(), eidolon: z.number().int().min(0).max(6),
});
const LightConeSchema = z.object({
  id: ScannerStringSchema, level: z.number().int().positive(),
  superimposition: z.number().int().min(1).max(5), _uid: ScannerStringSchema,
});
const RelicSchema = z.object({
  set_id: ScannerStringSchema, slot: ScannerStringSchema, _uid: ScannerStringSchema,
});
const HsrScannerSchema = z.strictObject({
  source: z.literal("HSR-Scanner"), build: ScannerStringSchema, version: z.literal(4),
  metadata: z.object({ uid: ScannerUidSchema }),
  characters: z.array(CharacterSchema).max(1000),
  light_cones: z.array(LightConeSchema).max(5000),
  relics: z.array(RelicSchema).max(10000),
});

export const HSR_SCANNER_LIGHT_CONE_INSTANCE_PREFIX = "hsr-scanner:light-cone:";
export const HSR_SCANNER_RELIC_INSTANCE_PREFIX = "hsr-scanner:relic:";

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
    lightCones: scan.light_cones.map(({ id, superimposition, level }, index) => ({
      instanceId: `${HSR_SCANNER_LIGHT_CONE_INSTANCE_PREFIX}${importedAt}:${index}`,
      logicalId: `light-cone:${id}`, superimposition, level,
    })),
    relics: scan.relics.map(({ set_id, slot }, index) => ({
      instanceId: `${HSR_SCANNER_RELIC_INSTANCE_PREFIX}${importedAt}:${index}`,
      setLogicalId: `relic-set:${set_id}`, slot,
    })),
    inventorySources: [{
      kind: "hsr-scanner", build: scan.build, formatVersion: scan.version, importedAt,
      counts: {
        characters: scan.characters.length, lightCones: scan.light_cones.length, relics: scan.relics.length,
      },
    }],
  });
}
