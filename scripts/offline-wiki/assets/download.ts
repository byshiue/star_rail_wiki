import { createHash } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AssetManifestEntrySchema, type AssetManifestEntry } from "./manifest";
import { hasExpectedImageSignature } from "./signature";

const DEFAULT_MAX_BYTES = 12 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const EXTENSIONS: Record<AssetManifestEntry["mediaType"], string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/webp": ".webp",
};

export type DownloadAssetOptions = {
  outputRoot: string;
  allowedHosts: readonly string[];
  fetchImpl?: typeof fetch;
  maxBytes?: number;
  maxRedirects?: number;
};

export type DownloadedAsset = {
  logicalId: string;
  path: string;
  checksum: string;
  bytes: number;
};

function validateTarget(url: URL, allowedHosts: ReadonlySet<string>, context: "source" | "redirect"): void {
  if (url.protocol !== "https:") throw new Error(`${context} URL must use HTTPS`);
  if (!allowedHosts.has(url.hostname)) throw new Error(`${context} target is outside the asset allowlist`);
}

async function fetchWithoutUnsafeRedirects(
  initialUrl: URL,
  fetchImpl: typeof fetch,
  allowedHosts: ReadonlySet<string>,
  maxRedirects: number,
): Promise<Response> {
  let url = initialUrl;
  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const response = await fetchImpl(url, { redirect: "manual", credentials: "omit" });
    if (!REDIRECT_STATUSES.has(response.status)) return response;
    if (redirectCount === maxRedirects) throw new Error("asset redirect limit exceeded");
    const location = response.headers.get("location");
    if (!location) throw new Error("asset redirect response is missing Location");
    url = new URL(location, url);
    validateTarget(url, allowedHosts, "redirect");
  }
  throw new Error("asset redirect limit exceeded");
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) > maxBytes) {
    throw new Error(`asset exceeds byte limit of ${maxBytes}`);
  }
  if (!response.body) throw new Error("asset response has no body");

  const chunks: Uint8Array[] = [];
  let bytes = 0;
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > maxBytes) {
      await reader.cancel();
      throw new Error(`asset exceeds byte limit of ${maxBytes}`);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function downloadAsset(
  input: AssetManifestEntry,
  options: DownloadAssetOptions,
): Promise<DownloadedAsset> {
  const asset = AssetManifestEntrySchema.parse(input);
  const allowedHosts = new Set(options.allowedHosts);
  if (!allowedHosts.has(asset.allowedHost)) throw new Error("asset host is outside the configured allowlist");
  const sourceUrl = new URL(asset.url);
  validateTarget(sourceUrl, allowedHosts, "source");

  const response = await fetchWithoutUnsafeRedirects(
    sourceUrl,
    options.fetchImpl ?? fetch,
    allowedHosts,
    options.maxRedirects ?? DEFAULT_MAX_REDIRECTS,
  );
  if (!response.ok) throw new Error(`asset request failed with HTTP ${response.status}`);
  const mediaType = response.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (mediaType !== asset.mediaType) {
    throw new Error(`asset media type mismatch: expected ${asset.mediaType}, received ${mediaType ?? "none"}`);
  }

  const body = await readBoundedBody(response, options.maxBytes ?? DEFAULT_MAX_BYTES);
  if (!hasExpectedImageSignature(body, asset.mediaType)) {
    throw new Error(`asset file signature does not match ${asset.mediaType}`);
  }
  const checksum = `sha256:${createHash("sha256").update(body).digest("hex")}`;
  if (asset.checksum !== null && asset.checksum !== checksum) {
    throw new Error(`asset checksum mismatch for ${asset.logicalId}`);
  }

  mkdirSync(options.outputRoot, { recursive: true });
  const path = join(options.outputRoot, `${asset.cacheKey}${EXTENSIONS[asset.mediaType]}`);
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, body, { flag: "wx" });
  renameSync(temporaryPath, path);
  return { logicalId: asset.logicalId, path, checksum, bytes: body.byteLength };
}
