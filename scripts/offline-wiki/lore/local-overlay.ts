import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  type BigIntStats,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  LocalFullTextRecordSchema,
  validateLocalFullTextRecords,
  type LocalFullTextRecord,
} from "./import/canonical";
import type { LoreRecord } from "./schema";

export type LocalFullTextOverlayRecord = Omit<LocalFullTextRecord, "schemaVersion" | "sourceDependencies"> & {
  schemaVersion?: 2;
  sourceDependencies?: LocalFullTextRecord["sourceDependencies"];
};

const MAX_OVERLAY_BYTES = 16 * 1024 * 1024;

export type LocalOverlayLoadOptions = {
  operations?: {
    afterOpen?: () => void;
    afterRead?: () => void;
  };
};

type StableStats = BigIntStats;

function sameIdentity(left: StableStats, right: StableStats): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function sameStableFile(left: StableStats, right: StableStats): boolean {
  return sameIdentity(left, right)
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function validateExactOverlayPath(path: string, releaseId: string): {
  resolvedPath: string;
  parentStates: Array<{ path: string; stats: StableStats }>;
  fileStats: StableStats;
} {
  if (!isAbsolute(path) || path !== resolve(path)) {
    throw new Error("normalized lore overlay path must be an absolute canonical lexical path");
  }
  const resolvedPath = resolve(path);
  const suffix = [".local", "offline-wiki", "imports", releaseId, "normalized", "current.jsonl"];
  let repositoryRoot = resolvedPath;
  for (let index = 0; index < suffix.length; index += 1) repositoryRoot = dirname(repositoryRoot);
  if (relative(repositoryRoot, resolvedPath) !== suffix.join(sep)) {
    throw new Error("normalized lore overlay must use the exact local import current.jsonl path");
  }
  if (realpathSync(repositoryRoot) !== repositoryRoot) {
    throw new Error("normalized lore repository root must be canonical");
  }

  const rootStats = lstatSync(repositoryRoot, { bigint: true });
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new Error("normalized lore repository root must be a regular directory");
  }
  const parentStates: Array<{ path: string; stats: StableStats }> = [{ path: repositoryRoot, stats: rootStats }];
  let current = repositoryRoot;
  for (const component of suffix.slice(0, -1)) {
    current = join(current, component);
    const stats = lstatSync(current, { bigint: true }) as StableStats;
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error(`normalized lore overlay parent is a symlink or non-directory: ${component}`);
    }
    parentStates.push({ path: current, stats });
  }
  const fileStats = lstatSync(resolvedPath, { bigint: true }) as StableStats;
  if (fileStats.isSymbolicLink() || !fileStats.isFile()) {
    throw new Error("normalized lore overlay must be a regular non-symlink file");
  }
  if (fileStats.size > BigInt(MAX_OVERLAY_BYTES)) {
    throw new Error("normalized lore overlay exceeds the 16 MiB size limit");
  }
  if (realpathSync(resolvedPath) !== resolvedPath) {
    throw new Error("normalized lore overlay path must be canonical");
  }
  return { resolvedPath, parentStates, fileStats };
}

function pathEntryExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}

function readVerifiedOverlay(path: string, releaseId: string, options: LocalOverlayLoadOptions): string {
  const initial = validateExactOverlayPath(path, releaseId);
  const descriptor = openSync(initial.resolvedPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const descriptorBefore = fstatSync(descriptor, { bigint: true }) as StableStats;
    if (!sameStableFile(initial.fileStats, descriptorBefore)) {
      throw new Error("normalized lore overlay identity changed before reading");
    }
    options.operations?.afterOpen?.();
    const bytes = readFileSync(descriptor);
    options.operations?.afterRead?.();
    const descriptorAfter = fstatSync(descriptor, { bigint: true }) as StableStats;
    const finalPath = validateExactOverlayPath(path, releaseId);
    if (!sameStableFile(descriptorBefore, descriptorAfter)
        || !sameStableFile(descriptorAfter, finalPath.fileStats)
        || bytes.byteLength !== Number(descriptorAfter.size)) {
      throw new Error("normalized lore overlay identity or contents changed while reading");
    }
    if (initial.parentStates.length !== finalPath.parentStates.length
        || initial.parentStates.some((parent, index) => !sameIdentity(parent.stats, finalPath.parentStates[index]!.stats))) {
      throw new Error("normalized lore overlay parent identity changed while reading");
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      throw new Error("normalized lore overlay is not valid UTF-8");
    }
  } finally {
    closeSync(descriptor);
  }
}

function parseJsonLines(text: string): unknown[] {
  const records: unknown[] = [];
  for (const [index, line] of text.replace(/\r\n?/g, "\n").split("\n").entries()) {
    if (line.length === 0) continue;
    try {
      records.push(JSON.parse(line) as unknown);
    } catch {
      throw new Error(`normalized lore overlay line ${index + 1} is not valid JSON`);
    }
  }
  return records;
}

function asOverlayRecord(value: unknown, version: 1 | 2): LocalFullTextOverlayRecord {
  if (version === 2) return LocalFullTextRecordSchema.parse(value) as LocalFullTextRecord;
  return value as LocalFullTextOverlayRecord;
}

export function loadLocalFullTextOverlay(
  path: string | undefined,
  releaseId: string,
  committedRecords: readonly LoreRecord[],
  options: LocalOverlayLoadOptions = {},
): Map<string, LocalFullTextOverlayRecord> {
  if (path === undefined || !pathEntryExists(path)) return new Map();
  const rawRecords = parseJsonLines(readVerifiedOverlay(path, releaseId, options));
  const version = validateLocalFullTextRecords(rawRecords);
  if (version === null) return new Map();

  const committedById = new Map(committedRecords.map((record) => [record.logicalId, record]));
  const overlay = new Map<string, LocalFullTextOverlayRecord>();
  for (const value of rawRecords) {
    const record = asOverlayRecord(value, version);
    if (overlay.has(record.logicalId)) {
      throw new Error(`duplicate normalized lore logical ID ${record.logicalId}`);
    }
    const committed = committedById.get(record.logicalId);
    if (!committed) throw new Error(`normalized lore overlay references unknown committed ID ${record.logicalId}`);
    if (record.releaseId !== releaseId || committed.releaseId !== releaseId) {
      throw new Error(`normalized lore overlay release mismatch for ${record.logicalId}`);
    }
    if (record.locale !== committed.locale) {
      throw new Error(`normalized lore overlay locale mismatch for ${record.logicalId}`);
    }
    if (record.family !== committed.family || record.kind !== committed.kind) {
      throw new Error(`normalized lore overlay taxonomy mismatch for ${record.logicalId}`);
    }
    const matchingSource = committed.provenance.some((source) => (
      source.sourceRevision === record.sourceRevision
      && source.sourceChecksum === record.sourceChecksum
    ));
    if (!matchingSource) {
      throw new Error(`normalized lore overlay provenance revision/checksum mismatch for ${record.logicalId}`);
    }
    overlay.set(record.logicalId, record);
  }
  return overlay;
}
