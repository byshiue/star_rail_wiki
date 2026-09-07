import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fsyncSync,
  linkSync,
  lstatSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";

export type AtomicOwnerOperations = {
  afterOwnerCandidateFsync?: (label: string, path: string) => void;
  afterOwnerPublishLink?: (label: string, path: string) => void;
  publishOwnerLink?: (candidatePath: string, ownerPath: string) => void;
  beforeOwnerDirectoryFsync?: (label: string, path: string, phase: "after-publish" | "after-candidate-cleanup") => void;
};

export type PublishedOwner<T> = {
  path: string;
  device: bigint;
  inode: bigint;
  value: T;
};

function isUnsupported(error: unknown): boolean {
  const code = error instanceof Error && "code" in error ? String(error.code) : "";
  return ["EPERM", "ENOTSUP", "EOPNOTSUPP", "EINVAL", "ENOSYS"].includes(code);
}

export function fsyncDirectory(path: string, label: string): void {
  let descriptor: number;
  try {
    descriptor = openSync(path, constants.O_RDONLY);
  } catch (error) {
    if (isUnsupported(error)) throw new Error(`${label} requires opening directories for fsync on a supported local POSIX filesystem`, { cause: error });
    throw error;
  }
  try {
    fsyncSync(descriptor);
  } catch (error) {
    if (isUnsupported(error)) throw new Error(`${label} requires directory fsync support on a supported local POSIX filesystem`, { cause: error });
    throw error;
  } finally {
    closeSync(descriptor);
  }
}

function fsyncOwnerDirectory(
  directory: string,
  label: string,
  phase: "after-publish" | "after-candidate-cleanup",
  operations?: AtomicOwnerOperations,
): void {
  try {
    operations?.beforeOwnerDirectoryFsync?.(label, directory, phase);
    fsyncDirectory(directory, label);
  } catch (error) {
    if (isUnsupported(error)) throw new Error(`${label} requires directory fsync support on a supported local POSIX filesystem`, { cause: error });
    throw error;
  }
}

export function observePublishedOwner<T>(
  path: string,
  label: string,
  parse: (value: unknown) => T,
): PublishedOwner<T> {
  const stats = lstatSync(path, { bigint: true });
  if (stats.isSymbolicLink() || !stats.isFile()) throw new Error(`${label} is not a regular owner file`);
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`${label} owner JSON is malformed`, { cause: error });
  }
  return { path, device: stats.dev, inode: stats.ino, value: parse(value) };
}

export function samePublishedOwner<T>(
  owner: PublishedOwner<T>,
  label: string,
  parse: (value: unknown) => T,
): boolean {
  try {
    const current = observePublishedOwner(owner.path, label, parse);
    return current.device === owner.device
      && current.inode === owner.inode
      && JSON.stringify(current.value) === JSON.stringify(owner.value);
  } catch {
    return false;
  }
}

export function unlinkPublishedOwner<T>(
  owner: PublishedOwner<T>,
  label: string,
  parse: (value: unknown) => T,
): boolean {
  if (!samePublishedOwner(owner, label, parse)) return false;
  unlinkSync(owner.path);
  return true;
}

export function publishAtomicOwner<T>(input: {
  directory: string;
  path: string;
  label: string;
  value: T;
  parse: (value: unknown) => T;
  operations?: AtomicOwnerOperations;
}): PublishedOwner<T> | null {
  const candidatePath = `${input.path}.candidate-${randomUUID()}.tmp`;
  let descriptor: number | null = null;
  let candidate: PublishedOwner<T> | null = null;
  let published: PublishedOwner<T> | null = null;
  try {
    descriptor = openSync(candidatePath, "wx", 0o600);
    writeFileSync(descriptor, JSON.stringify(input.value));
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    candidate = observePublishedOwner(candidatePath, `${input.label} candidate`, input.parse);
    input.operations?.afterOwnerCandidateFsync?.(input.label, candidatePath);
    try {
      (input.operations?.publishOwnerLink ?? linkSync)(candidatePath, input.path);
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST") return null;
      if (isUnsupported(error)) throw new Error(`${input.label} requires atomic hard-link publication on a supported local POSIX filesystem`, { cause: error });
      throw error;
    }
    published = { ...candidate, path: input.path };
    input.operations?.afterOwnerPublishLink?.(input.label, input.path);
    fsyncOwnerDirectory(input.directory, input.label, "after-publish", input.operations);
    if (!samePublishedOwner(published, input.label, input.parse)) {
      throw new Error(`${input.label} publish identity mismatch`);
    }
    unlinkPublishedOwner(candidate, `${input.label} candidate`, input.parse);
    fsyncOwnerDirectory(input.directory, input.label, "after-candidate-cleanup", input.operations);
    return observePublishedOwner(input.path, input.label, input.parse);
  } catch (error) {
    if (published && unlinkPublishedOwner(published, input.label, input.parse)) {
      try { fsyncDirectory(input.directory, input.label); } catch { /* preserve original publication error */ }
    }
    throw error;
  } finally {
    if (descriptor !== null) closeSync(descriptor);
    if (candidate && unlinkPublishedOwner(candidate, `${input.label} candidate`, input.parse)) {
      try { fsyncDirectory(input.directory, input.label); } catch { /* best-effort candidate cleanup */ }
    }
  }
}
