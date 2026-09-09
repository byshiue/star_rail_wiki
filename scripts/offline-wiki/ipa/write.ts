import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { StoryArchive } from "./story-schema";
import type { TextMapConflict } from "./source";

export type IpaArchiveAudit = {
  schemaVersion: 1;
  releaseId: string;
  summaryFallbackCount: 0;
  recordsByFamily: Record<string, number>;
  rejectionCount: number;
  textMapConflicts: TextMapConflict[];
  [key: string]: unknown;
};

export type WriteArchiveOptions = {
  repositoryRoot: string;
  releaseId: string;
  archive: StoryArchive;
  audit: IpaArchiveAudit;
  operations?: { beforePromote?: () => void };
};

export type ArchiveWriteResult = {
  root: string;
  archivePath: string;
  auditPath: string;
};

function validateRelease(releaseId: string): void {
  if (!/^4\.5-cn-\d{4}-\d{2}-\d{2}$/u.test(releaseId)) throw new Error(`invalid IPA archive release ${releaseId}`);
}

function serializeArchive(archive: StoryArchive): string {
  return archive.records.map((record) => JSON.stringify(record)).join("\n") + (archive.records.length > 0 ? "\n" : "");
}

function validateStaging(root: string, expectedRecords: number, releaseId: string): void {
  const archiveText = readFileSync(join(root, "archive.jsonl"), "utf8");
  const lines = archiveText.split("\n").filter(Boolean);
  if (lines.length !== expectedRecords) throw new Error("staged archive record count mismatch");
  for (const line of lines) {
    const record = JSON.parse(line) as { sections?: Array<{ body?: unknown }> };
    if (!Array.isArray(record.sections) || record.sections.length === 0 || record.sections.some((item) => typeof item.body !== "string" || item.body.length === 0)) {
      throw new Error("staged archive contains an incomplete record");
    }
  }
  const audit = JSON.parse(readFileSync(join(root, "audit.json"), "utf8")) as { releaseId?: unknown; summaryFallbackCount?: unknown };
  if (audit.releaseId !== releaseId || audit.summaryFallbackCount !== 0) throw new Error("staged audit identity mismatch");
}

export function writeArchiveTransaction(options: WriteArchiveOptions): ArchiveWriteResult {
  validateRelease(options.releaseId);
  if (options.audit.releaseId !== options.releaseId) throw new Error("audit release does not match requested release");
  const repositoryRoot = resolve(options.repositoryRoot);
  const base = join(repositoryRoot, ".local", "offline-wiki", "ipa-imports");
  const target = join(base, options.releaseId);
  const token = randomUUID();
  const staging = join(base, `.${options.releaseId}.staging-${token}`);
  const backup = join(base, `.${options.releaseId}.backup-${token}`);
  mkdirSync(base, { recursive: true });
  mkdirSync(staging, { recursive: false });
  let backedUp = false;
  try {
    writeFileSync(join(staging, "archive.jsonl"), serializeArchive(options.archive), { flag: "wx" });
    writeFileSync(join(staging, "audit.json"), `${JSON.stringify(options.audit, null, 2)}\n`, { flag: "wx" });
    validateStaging(staging, options.archive.records.length, options.releaseId);
    options.operations?.beforePromote?.();
    if (existsSync(target)) {
      renameSync(target, backup);
      backedUp = true;
    }
    try {
      renameSync(staging, target);
    } catch (error) {
      if (backedUp && !existsSync(target)) renameSync(backup, target);
      throw error;
    }
    if (backedUp) rmSync(backup, { recursive: true });
  } finally {
    if (existsSync(staging)) rmSync(staging, { recursive: true });
  }
  return { root: target, archivePath: join(target, "archive.jsonl"), auditPath: join(target, "audit.json") };
}
