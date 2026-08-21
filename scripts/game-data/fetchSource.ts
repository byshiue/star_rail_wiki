import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  ApprovedSourceManifestSchema,
  assertAllowlistedPaths,
  type ApprovedSource,
  type ApprovedSourceManifest,
} from "./sourceManifest";

export interface FetchedSourceFile {
  path: string;
  checksum: string;
  source: ApprovedSource;
  value: unknown;
}

export interface FetchedSource {
  manifest: ApprovedSourceManifest;
  files: Map<string, FetchedSourceFile>;
  sourceRoot: string;
}

const mutableRefs = new Set(["master", "latest"]);
const refQueryKeys = new Set(["ref", "reference", "branch", "revision", "rev", "version", "commit", "sha"]);

function decodeRepeated(value: string): string {
  let decoded = value;
  for (let pass = 0; pass < 3; pass += 1) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      throw new Error(`source URL contains invalid percent encoding: ${value}`);
    }
    if (next === decoded) return decoded;
    decoded = next;
  }
  return decoded;
}

function splitRef(value: string): string[] {
  return decodeRepeated(value).split("/").filter(Boolean).map((segment) => segment.toLowerCase());
}

function assertImmutableResolvedUrl(resolved: URL, source: ApprovedSource): void {
  const pathSegments = splitRef(resolved.pathname);
  const mutablePath = pathSegments.find((segment) => mutableRefs.has(segment));
  if (mutablePath) throw new Error(`resolved source URL contains mutable ${mutablePath} path segment`);

  for (const [rawKey, rawValue] of resolved.searchParams) {
    const key = decodeRepeated(rawKey).toLowerCase();
    if (!refQueryKeys.has(key)) continue;
    const mutableQueryRef = splitRef(rawValue).find((segment) => mutableRefs.has(segment));
    if (mutableQueryRef) {
      throw new Error(`resolved source URL contains mutable ${mutableQueryRef} query ref`);
    }
  }

  if (!pathSegments.includes(source.revision.toLowerCase())) {
    throw new Error(`resolved source URL must contain revision ${source.revision} as a path segment`);
  }
}

function immutableUrl(source: ApprovedSource, sourcePath: string): string {
  const template = source.downloadUrlTemplate ?? "{baseUrl}/{revision}/{path}";
  const resolved = new URL(template
    .replace("{baseUrl}", source.baseUrl.replace(/\/$/, ""))
    .replace("{revision}", source.revision)
    .replace("{path}", sourcePath));
  assertImmutableResolvedUrl(resolved, source);
  return resolved.href;
}

export async function fetchSource(
  manifest: ApprovedSourceManifest,
  sourceRoot?: string,
): Promise<FetchedSource> {
  const approvedManifest = ApprovedSourceManifestSchema.parse(manifest);
  assertAllowlistedPaths(approvedManifest);
  const sourceFiles = approvedManifest.sources.flatMap((source) =>
    Object.entries(source.fileChecksums).map(([sourcePath, expectedChecksum]) => ({
      source,
      sourcePath,
      expectedChecksum,
      resolvedUrl: immutableUrl(source, sourcePath),
    })),
  );
  const resolvedRoot = sourceRoot ?? await mkdtemp(path.join(tmpdir(), "star-rail-source-"));
  const files = new Map<string, FetchedSourceFile>();
  for (const { source, sourcePath, expectedChecksum, resolvedUrl } of sourceFiles) {
    const localPath = path.join(resolvedRoot, sourcePath);
    if (!sourceRoot) {
      const response = await fetch(resolvedUrl);
      if (!response.ok) throw new Error(`source fetch failed (${response.status}) for ${sourcePath}`);
      await mkdir(path.dirname(localPath), { recursive: true });
      await writeFile(localPath, Buffer.from(await response.arrayBuffer()));
    }
    const bytes = await readFile(localPath);
    const checksum = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (checksum !== expectedChecksum) {
      throw new Error(`checksum mismatch for ${sourcePath}: expected ${expectedChecksum}, received ${checksum}`);
    }
    files.set(sourcePath, {
      path: sourcePath,
      checksum,
      source,
      value: JSON.parse(bytes.toString("utf8")),
    });
  }
  return { manifest: approvedManifest, files, sourceRoot: resolvedRoot };
}
