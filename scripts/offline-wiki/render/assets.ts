import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AssetManifestEntry } from "../assets/manifest";
import { hasExpectedImageSignature } from "../assets/signature";
import type { RenderAsset } from "./volumes";

const EXTENSIONS: Record<AssetManifestEntry["mediaType"], string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};

export function loadCachedRenderAssets(
  manifest: AssetManifestEntry[],
  cacheRoot: string,
): RenderAsset[] {
  return manifest.flatMap((entry) => {
    const path = join(cacheRoot, `${entry.cacheKey}${EXTENSIONS[entry.mediaType]}`);
    if (!existsSync(path)) return [];
    const bytes = readFileSync(path);
    if (!hasExpectedImageSignature(bytes, entry.mediaType)) {
      throw new Error(`cached asset file signature does not match ${entry.mediaType}`);
    }
    const checksum = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (entry.checksum !== null && entry.checksum !== checksum) {
      throw new Error(`cached asset checksum mismatch for ${entry.logicalId}`);
    }
    return [{
      logicalId: entry.logicalId,
      dataUrl: `data:${entry.mediaType};base64,${bytes.toString("base64")}`,
      attribution: entry.attribution,
    }];
  });
}
