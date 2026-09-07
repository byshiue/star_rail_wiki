import { readFileSync } from "node:fs";
import { z } from "zod";

export const AssetManifestEntrySchema = z.strictObject({
  logicalId: z.string().min(1),
  role: z.enum(["character-splash", "light-cone-art", "relic-art", "du-icon"]),
  url: z.url().refine((value) => new URL(value).protocol === "https:", "asset URL must use HTTPS"),
  allowedHost: z.string().min(1),
  mediaType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/).nullable(),
  attribution: z.string().min(1),
  cacheKey: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/),
}).superRefine((entry, context) => {
  if (new URL(entry.url).hostname !== entry.allowedHost) {
    context.addIssue({
      code: "custom",
      path: ["allowedHost"],
      message: "asset URL host must match the declared allowlist host",
    });
  }
});

export const AssetManifestSchema = z.array(AssetManifestEntrySchema);
export type AssetManifestEntry = z.infer<typeof AssetManifestEntrySchema>;

export function loadAssetManifest(path: string): AssetManifestEntry[] {
  return AssetManifestSchema.parse(JSON.parse(readFileSync(path, "utf8")));
}
