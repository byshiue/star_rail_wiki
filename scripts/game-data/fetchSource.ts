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

function immutableUrl(source: ApprovedSource, sourcePath: string): string {
  const template = source.downloadUrlTemplate ?? "{baseUrl}/{revision}/{path}";
  return template
    .replace("{baseUrl}", source.baseUrl.replace(/\/$/, ""))
    .replace("{revision}", source.revision)
    .replace("{path}", sourcePath);
}

export async function fetchSource(
  manifest: ApprovedSourceManifest,
  sourceRoot?: string,
): Promise<FetchedSource> {
  const approvedManifest = ApprovedSourceManifestSchema.parse(manifest);
  assertAllowlistedPaths(approvedManifest);
  const resolvedRoot = sourceRoot ?? await mkdtemp(path.join(tmpdir(), "star-rail-source-"));
  const files = new Map<string, FetchedSourceFile>();
  for (const source of approvedManifest.sources) {
    for (const [sourcePath, expectedChecksum] of Object.entries(source.fileChecksums)) {
      const localPath = path.join(resolvedRoot, sourcePath);
      if (!sourceRoot) {
        const response = await fetch(immutableUrl(source, sourcePath));
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
  }
  return { manifest: approvedManifest, files, sourceRoot: resolvedRoot };
}
