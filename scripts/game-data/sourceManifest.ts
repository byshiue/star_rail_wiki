import { readFile } from "node:fs/promises";
import { z } from "zod";

export const requiredIndexes = [
  "characters",
  "character_ranks",
  "character_skills",
  "character_skill_trees",
  "light_cones",
  "light_cone_ranks",
  "relic_sets",
] as const;

export const requiredPaths = requiredIndexes.map((name) => `index_new/cn/${name}.json`);

const SourceManifestEntrySchema = z.strictObject({
  name: z.string().min(1),
  baseUrl: z.url(),
  revision: z.string().regex(/^[a-f0-9]{8,40}$/),
  gameVersion: z.string().min(1),
  channel: z.enum(["released", "preload"]),
  retrievedAt: z.iso.datetime(),
  downloadUrlTemplate: z.string().min(1)
    .refine(
      (template) => template.includes("{revision}"),
      "download URL template must include the immutable revision placeholder {revision}",
    )
    .refine(
      (template) => !/(?:^|[^A-Za-z0-9])(?:master|latest)(?=$|[^A-Za-z0-9])/i.test(template),
      "download URL template contains mutable ref master/latest",
    )
    .optional(),
  fileChecksums: z.record(
    z.string().min(1),
    z.string().regex(/^sha256:[a-f0-9]{64}$/),
  ),
});

export const ApprovedSourceManifestSchema = z.strictObject({
  releaseId: z.string().min(1),
  gameVersion: z.string().min(1),
  channel: z.literal("released"),
  importedAt: z.iso.datetime(),
  reviewedAt: z.iso.datetime().nullable(),
  previousReleaseId: z.string().min(1).nullable(),
  sources: z.array(SourceManifestEntrySchema).min(1),
});

export type ApprovedSourceManifest = z.infer<typeof ApprovedSourceManifestSchema>;
export type ApprovedSource = ApprovedSourceManifest["sources"][number];

export async function loadSourceManifest(manifestPath: string): Promise<ApprovedSourceManifest> {
  return ApprovedSourceManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
}

export function assertAllowlistedPaths(manifest: ApprovedSourceManifest): void {
  const owners = new Map<string, string>();
  for (const source of manifest.sources) {
    for (const sourcePath of Object.keys(source.fileChecksums)) {
      if (!requiredPaths.includes(sourcePath)) {
        throw new Error(`source path is not allowlisted: ${sourcePath}`);
      }
      if (owners.has(sourcePath)) {
        throw new Error(`source path has multiple owners: ${sourcePath}`);
      }
      owners.set(sourcePath, source.name);
    }
  }
}

export function assertRequiredPaths(manifest: ApprovedSourceManifest): void {
  assertAllowlistedPaths(manifest);
  const suppliedPaths = new Set(manifest.sources.flatMap((source) => Object.keys(source.fileChecksums)));
  for (const sourcePath of requiredPaths) {
    if (!suppliedPaths.has(sourcePath)) throw new Error(`required source path is missing: ${sourcePath}`);
  }
}
