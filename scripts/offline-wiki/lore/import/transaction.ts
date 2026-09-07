import { createHash, randomUUID } from "node:crypto";
import {
  closeSync, existsSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync,
  renameSync, rmSync, unlinkSync, writeFileSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { parseCanonicalLoreJsonl, serializeCanonicalLoreRecords, validateLocalFullTextRecords, type LocalFullTextRecord } from "./canonical";
import { loadLocalLoreManifest, readValidatedLocalLoreFile } from "./manifest";

type RejectionReason = "manifest-validation-failed" | "adapter-unsupported" | "source-validation-failed" | "canonical-validation-failed" | "staging-failed" | "promotion-failed" | "recovery-failed";
export type LocalImportReport = {
  status: "accepted" | "rejected";
  releaseId: string;
  acceptedCount: number;
  rejectedCount: number;
  inputChecksums: string[];
  outputChecksum: string | null;
  warnings: Array<"backup-cleanup-pending">;
  rejection: null | { reason: RejectionReason; sourcePaths: string[]; recoveryNames: string[] };
};
export type ImportLocalLoreOptions = {
  repositoryRoot: string; releaseId: string; manifestPath: string; sourceRoot: string; outputRoot?: string;
  operations?: { removeBackup?: (path: string) => void; beforePromote?: (targetRoot: string) => void };
};
type Journal = { schemaVersion: 1; phase: "prepared" | "backed-up" | "promoted"; targetName: "normalized"; stagingName: string; backupName: string | null; expectedOutputChecksum: string };

const JOURNAL_NAME = ".normalized-transaction.json";
const LOCK_NAME = ".normalized-transaction.lock";
const SAFE_NAME = /^\.normalized-(?:staging|backup)-[A-Za-z0-9-]+$/;
const sha = (value: string | Uint8Array) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
const contained = (root: string, path: string) => { const part = relative(root, path); return part === "" || (part !== ".." && !part.startsWith(`..${sep}`) && !isAbsolute(part)); };

function assertSafePath(root: string, path: string): void {
  let current = root;
  for (const segment of relative(root, path).split(sep).filter(Boolean)) {
    current = join(current, segment);
    if (!existsSync(current)) continue;
    const stats = lstatSync(current);
    if (stats.isSymbolicLink() || !stats.isDirectory() || realpathSync(current) !== current) throw new Error("output path contains a symlink or non-canonical component");
  }
}
function ensureDirectory(root: string, path: string): void { assertSafePath(root, path); mkdirSync(path, { recursive: true, mode: 0o700 }); assertSafePath(root, path); }
function writeJson(path: string, value: unknown): void { writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 }); }
function atomicJson(path: string, value: unknown): void { const temp = `${path}.${randomUUID()}.tmp`; writeJson(temp, value); renameSync(temp, path); }

function roots(options: ImportLocalLoreOptions) {
  const repositoryRoot = resolve(options.repositoryRoot);
  if (lstatSync(repositoryRoot).isSymbolicLink() || realpathSync(repositoryRoot) !== repositoryRoot) throw new Error("repository root must be canonical");
  const localRoot = resolve(repositoryRoot, ".local/offline-wiki");
  const releaseRoot = join(localRoot, "imports", options.releaseId);
  const targetRoot = resolve(options.outputRoot ?? join(releaseRoot, "normalized"));
  if (!contained(localRoot, targetRoot) || targetRoot === localRoot) throw new Error("output target escapes .local/offline-wiki");
  assertSafePath(repositoryRoot, targetRoot);
  return { repositoryRoot, localRoot, releaseRoot, targetRoot };
}
function rejected(releaseId: string, reason: RejectionReason, checksums: string[] = [], paths: string[] = [], recoveryNames: string[] = []): LocalImportReport {
  return { status: "rejected", releaseId, acceptedCount: 0, rejectedCount: 1, inputChecksums: checksums, outputChecksum: null, warnings: [], rejection: { reason, sourcePaths: paths, recoveryNames } };
}
function persistRejected(repositoryRoot: string, releaseRoot: string, report: LocalImportReport): void {
  const dir = join(releaseRoot, "reports"); ensureDirectory(repositoryRoot, dir); writeJson(join(dir, "last-rejected.json"), report);
}
function parseJournal(path: string): Journal {
  const value = JSON.parse(readFileSync(path, "utf8")) as Partial<Journal>;
  const keys = value && typeof value === "object" ? Object.keys(value).sort().join(",") : "";
  if (keys !== "backupName,expectedOutputChecksum,phase,schemaVersion,stagingName,targetName" || value.schemaVersion !== 1 || !["prepared", "backed-up", "promoted"].includes(String(value.phase)) || value.targetName !== "normalized" || typeof value.stagingName !== "string" || !SAFE_NAME.test(value.stagingName) || (value.backupName !== null && (typeof value.backupName !== "string" || !SAFE_NAME.test(value.backupName))) || typeof value.expectedOutputChecksum !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value.expectedOutputChecksum)) throw new Error("malformed transaction journal");
  return value as Journal;
}
function validateAcceptedReport(value: unknown): LocalImportReport {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid overlay report");
  const report = value as Partial<LocalImportReport>;
  if (Object.keys(report).sort().join(",") !== "acceptedCount,inputChecksums,outputChecksum,rejectedCount,rejection,releaseId,status,warnings" || report.status !== "accepted" || typeof report.releaseId !== "string" || !Number.isInteger(report.acceptedCount) || report.acceptedCount! < 0 || report.rejectedCount !== 0 || !Array.isArray(report.inputChecksums) || !report.inputChecksums.every((item) => typeof item === "string" && /^sha256:[a-f0-9]{64}$/.test(item)) || typeof report.outputChecksum !== "string" || !/^sha256:[a-f0-9]{64}$/.test(report.outputChecksum) || !Array.isArray(report.warnings) || !report.warnings.every((item) => item === "backup-cleanup-pending") || report.rejection !== null) throw new Error("invalid overlay report");
  return report as LocalImportReport;
}
function validateOverlay(path: string, expected?: string): LocalImportReport {
  if (!existsSync(path) || lstatSync(path).isSymbolicLink() || !lstatSync(path).isDirectory()) throw new Error("overlay missing or unsafe");
  const text = readFileSync(join(path, "current.jsonl"), "utf8");
  const records = text.length === 0 ? [] : text.trimEnd().split("\n").map((line) => JSON.parse(line) as LocalFullTextRecord);
  validateLocalFullTextRecords(records);
  const report = validateAcceptedReport(JSON.parse(readFileSync(join(path, "report.json"), "utf8")));
  if (report.status !== "accepted" || report.outputChecksum !== sha(text) || report.acceptedCount !== records.length || (expected && report.outputChecksum !== expected)) throw new Error("overlay report/checksum mismatch");
  return report;
}
function cleanupBackup(path: string, options: ImportLocalLoreOptions): void { (options.operations?.removeBackup ?? ((value) => rmSync(value, { recursive: true, force: true })))(path); }
function recoveryNames(releaseRoot: string): string[] {
  if (!existsSync(releaseRoot)) return [JOURNAL_NAME];
  return [JOURNAL_NAME, ...readdirSync(releaseRoot).filter((name) => /^\.normalized-backup-[A-Za-z0-9-]+$/.test(name)).sort()];
}
function acquireLock(releaseRoot: string): { path: string; nonce: string } {
  const path = join(releaseRoot, LOCK_NAME); const nonce = randomUUID();
  let descriptor: number;
  try { descriptor = openSync(path, "wx", 0o600); }
  catch {
    let existing: { pid?: number; nonce?: string };
    try { existing = JSON.parse(readFileSync(path, "utf8")) as { pid?: number; nonce?: string }; }
    catch { throw new Error("another import or manual recovery is active"); }
    if (!Number.isInteger(existing.pid) || existing.pid! <= 0 || typeof existing.nonce !== "string") throw new Error("another import or manual recovery is active");
    try { process.kill(existing.pid!, 0); throw new Error("another import or manual recovery is active"); }
    catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") throw error;
    }
    unlinkSync(path);
    descriptor = openSync(path, "wx", 0o600);
  }
  try { writeFileSync(descriptor, JSON.stringify({ pid: process.pid, nonce })); } finally { closeSync(descriptor); }
  return { path, nonce };
}
function releaseLock(lock: { path: string; nonce: string }): void {
  try { const value = JSON.parse(readFileSync(lock.path, "utf8")) as { nonce?: string }; if (value.nonce === lock.nonce) unlinkSync(lock.path); } catch { /* fail closed: retain an unverified lock */ }
}

function recover(options: ImportLocalLoreOptions, context: ReturnType<typeof roots>): LocalImportReport | null {
  ensureDirectory(context.repositoryRoot, context.releaseRoot);
  const journalPath = join(context.releaseRoot, JOURNAL_NAME);
  if (!existsSync(journalPath)) return null;
  const journal = parseJournal(journalPath);
  const backup = journal.backupName ? join(context.releaseRoot, journal.backupName) : null;
  const staging = join(context.releaseRoot, journal.stagingName);
  if (journal.phase === "prepared") {
    if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
    unlinkSync(journalPath); return null;
  }
  if (existsSync(context.targetRoot)) {
    const committed = validateOverlay(context.targetRoot, journal.expectedOutputChecksum);
    if (backup && existsSync(backup)) {
      try { cleanupBackup(backup, options); } catch { return { ...committed, warnings: ["backup-cleanup-pending"] }; }
    }
    if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
    unlinkSync(journalPath); return committed;
  }
  if (!backup || !existsSync(backup)) throw new Error("manual recovery required: backup missing");
  validateOverlay(backup);
  renameSync(backup, context.targetRoot);
  if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
  unlinkSync(journalPath);
  return null;
}

function promote(options: ImportLocalLoreOptions, context: ReturnType<typeof roots>, output: string, report: LocalImportReport): LocalImportReport {
  ensureDirectory(context.repositoryRoot, context.releaseRoot);
  const staging = mkdtempSync(join(context.releaseRoot, ".normalized-staging-"));
  const stagingName = staging.slice(context.releaseRoot.length + 1);
  const backupName = `.normalized-backup-${randomUUID()}`;
  const backup = join(context.releaseRoot, backupName);
  const journalPath = join(context.releaseRoot, JOURNAL_NAME);
  let journal: Journal = { schemaVersion: 1, phase: "prepared", targetName: "normalized", stagingName, backupName: existsSync(context.targetRoot) ? backupName : null, expectedOutputChecksum: report.outputChecksum! };
  try {
    writeFileSync(join(staging, "current.jsonl"), output, { mode: 0o600 }); writeJson(join(staging, "report.json"), report); validateOverlay(staging, report.outputChecksum!);
    atomicJson(journalPath, journal);
    if (existsSync(context.targetRoot)) { validateOverlay(context.targetRoot); renameSync(context.targetRoot, backup); journal = { ...journal, phase: "backed-up" }; atomicJson(journalPath, journal); }
    options.operations?.beforePromote?.(context.targetRoot);
    renameSync(staging, context.targetRoot); journal = { ...journal, phase: "promoted" }; atomicJson(journalPath, journal); validateOverlay(context.targetRoot, report.outputChecksum!);
  } catch {
    if (existsSync(backup) && !existsSync(context.targetRoot)) { renameSync(backup, context.targetRoot); if (existsSync(journalPath)) unlinkSync(journalPath); }
    throw new Error("promotion failed");
  } finally { if (existsSync(staging)) rmSync(staging, { recursive: true, force: true }); }
  if (existsSync(backup)) { try { cleanupBackup(backup, options); } catch { return { ...report, warnings: ["backup-cleanup-pending"] }; } }
  unlinkSync(journalPath); return report;
}

function runImport(options: ImportLocalLoreOptions, context: ReturnType<typeof roots>): LocalImportReport {
  try { const recovered = recover(options, context); if (recovered) return recovered; }
  catch { const report = rejected(options.releaseId, "recovery-failed", [], [], recoveryNames(context.releaseRoot)); persistRejected(context.repositoryRoot, context.releaseRoot, report); return report; }
  let manifest;
  try { manifest = loadLocalLoreManifest(options.manifestPath, options.releaseId, options.sourceRoot); }
  catch { const report = rejected(options.releaseId, "manifest-validation-failed"); persistRejected(context.repositoryRoot, context.releaseRoot, report); return report; }
  const checksums = manifest.files.map((file) => file.checksum); const paths = manifest.files.map((file) => file.path);
  if (manifest.adapter !== "canonical-jsonl" || manifest.files.length !== 1) { const report = rejected(options.releaseId, "adapter-unsupported", checksums, paths); persistRejected(context.repositoryRoot, context.releaseRoot, report); return report; }
  let text: string;
  try { text = readValidatedLocalLoreFile(manifest, options.sourceRoot, manifest.files[0].path).text; }
  catch { const report = rejected(options.releaseId, "source-validation-failed", checksums, paths); persistRejected(context.repositoryRoot, context.releaseRoot, report); return report; }
  let records: LocalFullTextRecord[];
  try { records = parseCanonicalLoreJsonl(text, manifest); }
  catch { const report = rejected(options.releaseId, "canonical-validation-failed", checksums, paths); persistRejected(context.repositoryRoot, context.releaseRoot, report); return report; }
  const output = serializeCanonicalLoreRecords(records);
  const report: LocalImportReport = { status: "accepted", releaseId: options.releaseId, acceptedCount: records.length, rejectedCount: 0, inputChecksums: checksums, outputChecksum: sha(output), warnings: [], rejection: null };
  try { return promote(options, context, output, report); }
  catch { const failure = rejected(options.releaseId, "promotion-failed", checksums, paths, recoveryNames(context.releaseRoot)); persistRejected(context.repositoryRoot, context.releaseRoot, failure); return failure; }
}

export function importLocalLore(options: ImportLocalLoreOptions): LocalImportReport {
  const context = roots(options);
  ensureDirectory(context.repositoryRoot, context.releaseRoot);
  let lock: { path: string; nonce: string };
  try { lock = acquireLock(context.releaseRoot); }
  catch { const report = rejected(options.releaseId, "recovery-failed", [], [], [LOCK_NAME, ...recoveryNames(context.releaseRoot)]); persistRejected(context.repositoryRoot, context.releaseRoot, report); return report; }
  try { return runImport(options, context); } finally { releaseLock(lock); }
}
