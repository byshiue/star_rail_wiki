import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  type BigIntStats,
} from "node:fs";
import {
  isAbsolute,
  posix,
  relative,
  resolve,
  sep,
} from "node:path";
import { z } from "zod";
import { LoreFamilySchema } from "../schema";

const FILE_BYTE_LIMIT = 16 * 1024 * 1024;
const BATCH_BYTE_LIMIT = 512 * 1024 * 1024;
const WINDOWS_PATH_PREFIX = /^(?:[A-Za-z]:|[\\/]{2})/;
const SUPPORTED_RELEASE_IDS = new Set([
  "4.4-cn-2026-08-21",
  "4.4-fixture",
]);

const ManifestFileSchema = z.strictObject({
  path: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  checksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
});

const LocalLoreManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  releaseId: z.string().min(1),
  locale: z.literal("zh-CN"),
  source: z.strictObject({
    name: z.string().min(1),
    revision: z.string().min(1),
    exportedAt: z.iso.datetime(),
  }),
  adapter: z.string().min(1),
  adapterVersion: z.number().int().positive(),
  families: z.array(LoreFamilySchema).min(1),
  userProvided: z.literal(true, {
    error: "manifest must be explicitly user-provided",
  }),
  files: z.array(ManifestFileSchema).min(1),
});

export type LocalLoreManifest = z.infer<typeof LocalLoreManifestSchema>;

function isContained(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return fromRoot === "" || (!fromRoot.startsWith(`..${sep}`) && fromRoot !== ".." && !isAbsolute(fromRoot));
}

type StablePath = {
  absolutePath: string;
  canonicalPath: string;
  stats: BigIntStats;
};

type StableFile = StablePath & {
  bytes: Buffer;
};

function sameIdentity(left: BigIntStats, right: BigIntStats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameStableMetadata(left: BigIntStats, right: BigIntStats): boolean {
  return sameIdentity(left, right)
    && left.mode === right.mode
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function requireCanonicalDirectory(path: string): StablePath {
  const absolutePath = resolve(path);
  const stats = lstatSync(absolutePath, { bigint: true });
  const canonicalPath = realpathSync(absolutePath);
  if (stats.isSymbolicLink() || canonicalPath !== absolutePath) {
    throw new Error("source root must not be a symlink or pass through one");
  }
  if (!stats.isDirectory()) {
    throw new Error("source root must be a directory");
  }
  return { absolutePath, canonicalPath, stats };
}

function snapshotRegularPath(path: string, label: string): StablePath {
  const absolutePath = resolve(path);
  const stats = lstatSync(absolutePath, { bigint: true });
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`${label} must be a regular file, not a symlink`);
  }
  const canonicalPath = realpathSync(absolutePath);
  if (canonicalPath !== absolutePath) {
    throw new Error(`${label} must use a canonical path without symlink components`);
  }
  return { absolutePath, canonicalPath, stats };
}

function openNoFollow(path: string, label: string): number {
  const noFollow = (constants as Record<string, number | undefined>).O_NOFOLLOW;
  if (typeof noFollow !== "number") {
    throw new Error(`cannot safely open ${label}: O_NOFOLLOW is unavailable`);
  }
  return openSync(path, constants.O_RDONLY | noFollow);
}

function inspectStableRegularFile(
  path: string,
  label: string,
  readContents: boolean,
  expectedBytes?: number,
): StableFile {
  const before = snapshotRegularPath(path, label);
  let descriptor: number | undefined;
  try {
    descriptor = openNoFollow(before.absolutePath, label);
    const opened = fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || !sameStableMetadata(before.stats, opened)) {
      throw new Error(`${label} changed before it could be opened safely`);
    }
    if (expectedBytes !== undefined && opened.size !== BigInt(expectedBytes)) {
      throw new Error(`${label} byte count mismatch`);
    }

    const bytes = readContents ? readFileSync(descriptor) : Buffer.alloc(0);
    const afterRead = fstatSync(descriptor, { bigint: true });
    if (!sameStableMetadata(opened, afterRead)) {
      throw new Error(`${label} changed while it was being read`);
    }

    const afterPath = snapshotRegularPath(before.absolutePath, label);
    if (
      afterPath.canonicalPath !== before.canonicalPath
      || !sameStableMetadata(before.stats, afterPath.stats)
    ) {
      throw new Error(`${label} path changed while it was being validated`);
    }

    return { ...afterPath, stats: afterRead, bytes };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} is not valid UTF-8`);
  }
}

function parseManifest(bytes: Uint8Array): LocalLoreManifest {
  const text = decodeUtf8(bytes, "manifest");
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("manifest is not valid JSON");
  }
  return LocalLoreManifestSchema.parse(raw);
}

function validateRelativePath(path: string): void {
  if (
    isAbsolute(path)
    || WINDOWS_PATH_PREFIX.test(path)
    || path.includes("\\")
    || posix.normalize(path) !== path
    || path.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    throw new Error(`manifest file path is not a normalized relative path: ${path}`);
  }
}

function checksum(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function snapshotDirectory(path: string, sourceRoot: string): StablePath {
  const absolutePath = resolve(path);
  const stats = lstatSync(absolutePath, { bigint: true });
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`source root contains a directory symlink or non-directory: ${relative(sourceRoot, absolutePath)}`);
  }
  const canonicalPath = realpathSync(absolutePath);
  if (canonicalPath !== absolutePath || !isContained(sourceRoot, canonicalPath)) {
    throw new Error(`source directory escapes its canonical root: ${relative(sourceRoot, absolutePath)}`);
  }
  return { absolutePath, canonicalPath, stats };
}

function enumerateRegularFiles(
  sourceRoot: string,
  directory = sourceRoot,
  result: Map<string, BigIntStats> = new Map(),
): Map<string, BigIntStats> {
  const before = snapshotDirectory(directory, sourceRoot);
  const entries = readdirSync(directory, { withFileTypes: true });
  const entryNames = entries.map((entry) => entry.name).sort();
  for (const entry of entries) {
    const absolutePath = resolve(directory, entry.name);
    const metadata = lstatSync(absolutePath, { bigint: true });
    if (metadata.isSymbolicLink()) {
      throw new Error(`source root contains a symlink: ${relative(sourceRoot, absolutePath)}`);
    }
    const canonicalPath = realpathSync(absolutePath);
    if (!isContained(sourceRoot, canonicalPath)) {
      throw new Error(`source entry escapes source root: ${relative(sourceRoot, absolutePath)}`);
    }
    if (metadata.isDirectory()) {
      enumerateRegularFiles(sourceRoot, absolutePath, result);
    } else if (metadata.isFile()) {
      const stableFile = inspectStableRegularFile(
        absolutePath,
        `source file ${relative(sourceRoot, absolutePath)}`,
        false,
      );
      result.set(stableFile.canonicalPath, stableFile.stats);
    } else {
      throw new Error(`source root contains a non-regular entry: ${relative(sourceRoot, absolutePath)}`);
    }
  }

  const entryNamesAfter = readdirSync(directory).sort();
  const after = snapshotDirectory(directory, sourceRoot);
  if (
    before.canonicalPath !== after.canonicalPath
    || !sameStableMetadata(before.stats, after.stats)
    || entryNames.length !== entryNamesAfter.length
    || entryNames.some((name, index) => name !== entryNamesAfter[index])
  ) {
    throw new Error(`source directory changed during enumeration: ${relative(sourceRoot, directory) || "."}`);
  }
  return result;
}

export function validateExactPathSet(
  declaredPaths: ReadonlySet<string>,
  actualPaths: ReadonlySet<string>,
): void {
  for (const actualPath of actualPaths) {
    if (!declaredPaths.has(actualPath)) {
      throw new Error(`undeclared source file found during enumeration: ${actualPath}`);
    }
  }
  for (const declaredPath of declaredPaths) {
    if (!actualPaths.has(declaredPath)) {
      throw new Error(`declared source file missing from stable enumeration: ${declaredPath}`);
    }
  }
}

export function loadLocalLoreManifest(
  path: string,
  expectedReleaseId: string,
  sourceRoot: string,
): LocalLoreManifest {
  if (!SUPPORTED_RELEASE_IDS.has(expectedReleaseId)) {
    throw new Error(
      `local lore manifests only support exact 4.4 release IDs; received ${expectedReleaseId}`,
    );
  }

  const rootBefore = requireCanonicalDirectory(sourceRoot);
  const canonicalRoot = rootBefore.canonicalPath;
  const manifestFile = inspectStableRegularFile(path, "manifest", true);
  const canonicalManifest = manifestFile.canonicalPath;
  const manifest = parseManifest(manifestFile.bytes);

  if (manifest.releaseId === "latest") {
    throw new Error("manifest release cannot be latest");
  }
  if (!SUPPORTED_RELEASE_IDS.has(manifest.releaseId)) {
    throw new Error(`manifest release ${manifest.releaseId} is not a 4.4 release`);
  }
  if (manifest.releaseId !== expectedReleaseId) {
    throw new Error(`manifest release ${manifest.releaseId} does not match ${expectedReleaseId}`);
  }

  const declaredPaths = new Set<string>();
  let declaredBatchBytes = 0;
  for (const file of manifest.files) {
    validateRelativePath(file.path);
    if (declaredPaths.has(file.path)) {
      throw new Error(`duplicate manifest file path: ${file.path}`);
    }
    declaredPaths.add(file.path);
    if (file.bytes > FILE_BYTE_LIMIT) {
      throw new Error(`manifest file exceeds the 16 MiB file limit: ${file.path}`);
    }
    declaredBatchBytes += file.bytes;
  }
  if (declaredBatchBytes > BATCH_BYTE_LIMIT) {
    throw new Error("manifest exceeds the 512 MiB batch limit");
  }

  const declaredCanonicalPaths = new Map<string, BigIntStats>();
  for (const file of manifest.files) {
    const absolutePath = resolve(canonicalRoot, file.path);
    if (!isContained(canonicalRoot, absolutePath)) {
      throw new Error(`manifest file path escapes source root: ${file.path}`);
    }
    if (absolutePath === canonicalManifest) {
      throw new Error("manifest cannot declare itself as source input");
    }
    const stableFile = inspectStableRegularFile(
      absolutePath,
      `manifest file ${file.path}`,
      true,
      file.bytes,
    );
    const canonicalPath = stableFile.canonicalPath;
    if (!isContained(canonicalRoot, canonicalPath)) {
      throw new Error(`manifest file escapes source root: ${file.path}`);
    }
    decodeUtf8(stableFile.bytes, file.path);
    if (checksum(stableFile.bytes) !== file.checksum) {
      throw new Error(`manifest checksum mismatch for ${file.path}`);
    }
    declaredCanonicalPaths.set(canonicalPath, stableFile.stats);
  }

  const actualFiles = enumerateRegularFiles(canonicalRoot);
  if (isContained(canonicalRoot, canonicalManifest)) actualFiles.delete(canonicalManifest);
  validateExactPathSet(
    new Set(declaredCanonicalPaths.keys()),
    new Set(actualFiles.keys()),
  );
  for (const [actualPath, actualStats] of actualFiles) {
    const declaredStats = declaredCanonicalPaths.get(actualPath);
    if (!declaredStats) throw new Error(`internal path-set mismatch: ${actualPath}`);
    if (!sameStableMetadata(declaredStats, actualStats)) {
      throw new Error(`source file changed during validation: ${relative(canonicalRoot, actualPath)}`);
    }
  }

  const rootAfter = requireCanonicalDirectory(canonicalRoot);
  if (!sameStableMetadata(rootBefore.stats, rootAfter.stats)) {
    throw new Error("source root changed during validation");
  }
  const manifestAfter = inspectStableRegularFile(canonicalManifest, "manifest", false);
  if (!sameStableMetadata(manifestFile.stats, manifestAfter.stats)) {
    throw new Error("manifest changed during validation");
  }

  return manifest;
}
