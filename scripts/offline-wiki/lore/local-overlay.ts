import { existsSync, lstatSync, readFileSync, realpathSync } from "node:fs";
import { resolve, sep } from "node:path";
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
): Map<string, LocalFullTextOverlayRecord> {
  if (path === undefined || !existsSync(path)) return new Map();

  const resolvedPath = resolve(path);
  const requiredSegment = `${sep}.local${sep}offline-wiki${sep}imports${sep}${releaseId}${sep}`;
  if (!resolvedPath.includes(requiredSegment) || !realpathSync(resolvedPath).includes(requiredSegment)) {
    throw new Error("normalized lore full text must come from the release's local import tree, never a Git data path");
  }
  const stats = lstatSync(resolvedPath);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error("normalized lore overlay must be a regular local file");
  }

  const rawRecords = parseJsonLines(readFileSync(resolvedPath, "utf8"));
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
