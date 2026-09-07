import { createHash } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
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

function requireCanonicalDirectory(path: string): string {
  const absolutePath = resolve(path);
  const metadata = lstatSync(absolutePath);
  if (metadata.isSymbolicLink() || realpathSync(absolutePath) !== absolutePath) {
    throw new Error("source root must not be a symlink or pass through one");
  }
  if (!metadata.isDirectory()) {
    throw new Error("source root must be a directory");
  }
  return absolutePath;
}

function requireCanonicalManifest(path: string, sourceRoot: string): string {
  const absolutePath = resolve(path);
  const metadata = lstatSync(absolutePath);
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error("manifest must be a regular file, not a symlink");
  }
  const canonicalPath = realpathSync(absolutePath);
  if (canonicalPath !== absolutePath || !isContained(sourceRoot, canonicalPath)) {
    throw new Error("manifest must stay inside the canonical source root");
  }
  return canonicalPath;
}

function decodeUtf8(bytes: Uint8Array, label: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${label} is not valid UTF-8`);
  }
}

function parseManifest(path: string): LocalLoreManifest {
  const text = decodeUtf8(readFileSync(path), "manifest");
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

function enumerateRegularFiles(
  sourceRoot: string,
  directory = sourceRoot,
  result: Set<string> = new Set(),
): Set<string> {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = resolve(directory, entry.name);
    const metadata = lstatSync(absolutePath);
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
      result.add(canonicalPath);
    } else {
      throw new Error(`source root contains a non-regular entry: ${relative(sourceRoot, absolutePath)}`);
    }
  }
  return result;
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

  const canonicalRoot = requireCanonicalDirectory(sourceRoot);
  const canonicalManifest = requireCanonicalManifest(path, canonicalRoot);
  const manifest = parseManifest(canonicalManifest);

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

  const declaredCanonicalPaths = new Set<string>();
  for (const file of manifest.files) {
    const absolutePath = resolve(canonicalRoot, file.path);
    if (!isContained(canonicalRoot, absolutePath)) {
      throw new Error(`manifest file path escapes source root: ${file.path}`);
    }
    const metadata = lstatSync(absolutePath);
    if (metadata.isSymbolicLink()) {
      throw new Error(`manifest file must not be a symlink: ${file.path}`);
    }
    if (!metadata.isFile()) {
      throw new Error(`manifest file is not a regular file: ${file.path}`);
    }
    const canonicalPath = realpathSync(absolutePath);
    if (!isContained(canonicalRoot, canonicalPath)) {
      throw new Error(`manifest file escapes source root: ${file.path}`);
    }
    if (canonicalPath === canonicalManifest) {
      throw new Error("manifest cannot declare itself as source input");
    }
    if (metadata.size !== file.bytes) {
      throw new Error(`manifest byte count mismatch for ${file.path}`);
    }
    const bytes = readFileSync(canonicalPath);
    decodeUtf8(bytes, file.path);
    if (checksum(bytes) !== file.checksum) {
      throw new Error(`manifest checksum mismatch for ${file.path}`);
    }
    declaredCanonicalPaths.add(canonicalPath);
  }

  const actualFiles = enumerateRegularFiles(canonicalRoot);
  actualFiles.delete(canonicalManifest);
  for (const actualPath of actualFiles) {
    if (!declaredCanonicalPaths.has(actualPath)) {
      throw new Error(`undeclared source file: ${relative(canonicalRoot, actualPath)}`);
    }
  }

  return manifest;
}
