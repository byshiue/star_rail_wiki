import { createHash, randomUUID } from "node:crypto";
import {
  closeSync, existsSync, fstatSync, fsyncSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync,
  renameSync, rmSync, unlinkSync, writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { materializeCanonicalLoreInput, parseCanonicalLoreJsonl, serializeCanonicalLoreRecords, validateLocalFullTextRecords, type LocalFullTextRecord } from "./canonical";
import {
  fsyncDirectory,
  observePublishedOwner,
  publishAtomicOwner,
  samePublishedOwner,
  unlinkPublishedOwner,
  type PublishedOwner,
} from "../../atomic-owner";
import { loadLocalLoreManifest, readValidatedLocalLoreFile } from "./manifest";
import { convertCompatibleGameData } from "./adapters/game-data";
import { convertSavedHoyoWiki } from "./adapters/hoyowiki";
import type { AdapterResult, ImportRejection } from "./adapters/types";

type RejectionReason = "manifest-validation-failed" | "adapter-unsupported" | "adapter-rejected" | "source-validation-failed" | "canonical-validation-failed" | "staging-failed" | "promotion-failed" | "recovery-failed";
export type LocalImportReport = {
  status: "accepted" | "rejected";
  releaseId: string;
  acceptedCount: number;
  rejectedCount: number;
  inputChecksums: string[];
  outputChecksum: string | null;
  warnings: Array<"backup-cleanup-pending">;
  rejection: null | { reason: RejectionReason; sourcePaths: string[]; recoveryNames: string[]; items: ImportRejection[] };
};
export type ImportLocalLoreOptions = {
  repositoryRoot: string; releaseId: string; manifestPath: string; sourceRoot: string; outputRoot?: string;
  operations?: {
    removeBackup?: (path: string) => void;
    beforeBackupRename?: () => void;
    beforePromote?: (targetRoot: string) => void;
    duringLockReclaim?: () => void;
    inspectReclaimGuardFd?: (descriptor: number) => void;
    beforeAtomicRename?: (temporaryPath: string, targetPath: string) => void;
    afterOwnerCandidateFsync?: (label: string, path: string) => void;
    afterOwnerPublishLink?: (label: string, path: string) => void;
  };
};
type Journal = { schemaVersion: 1; phase: "prepared" | "backed-up" | "promoted"; targetName: "normalized"; stagingName: string; backupName: string | null; priorOutputChecksum: string | null; expectedOutputChecksum: string };

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
function atomicJson(path: string, value: unknown, options: ImportLocalLoreOptions): void {
  const temp = `${path}.${randomUUID()}.tmp`;
  try {
    writeJson(temp, value);
    const descriptor = openSync(temp, "r");
    try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
    options.operations?.beforeAtomicRename?.(temp, path);
    renameSync(temp, path);
    fsyncDirectory(dirname(path), "atomic JSON");
  } finally {
    if (existsSync(temp)) unlinkSync(temp);
  }
}

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
function rejected(releaseId: string, reason: RejectionReason, checksums: string[] = [], paths: string[] = [], recoveryNames: string[] = [], items: ImportRejection[] = []): LocalImportReport {
  return { status: "rejected", releaseId, acceptedCount: 0, rejectedCount: Math.max(1, items.length), inputChecksums: checksums, outputChecksum: null, warnings: [], rejection: { reason, sourcePaths: paths, recoveryNames, items } };
}
function persistRejected(repositoryRoot: string, releaseRoot: string, report: LocalImportReport, options: ImportLocalLoreOptions): void {
  const dir = join(releaseRoot, "reports");
  ensureDirectory(repositoryRoot, dir);
  try { atomicJson(join(dir, "last-rejected.json"), report, options); }
  catch { /* the returned rejection remains authoritative */ }
}
function parseJournal(path: string): Journal {
  const value = JSON.parse(readFileSync(path, "utf8")) as Partial<Journal>;
  const keys = value && typeof value === "object" ? Object.keys(value).sort().join(",") : "";
  if (keys !== "backupName,expectedOutputChecksum,phase,priorOutputChecksum,schemaVersion,stagingName,targetName" || value.schemaVersion !== 1 || !["prepared", "backed-up", "promoted"].includes(String(value.phase)) || value.targetName !== "normalized" || typeof value.stagingName !== "string" || !SAFE_NAME.test(value.stagingName) || (value.backupName !== null && (typeof value.backupName !== "string" || !SAFE_NAME.test(value.backupName))) || (value.priorOutputChecksum !== null && (typeof value.priorOutputChecksum !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value.priorOutputChecksum))) || (value.priorOutputChecksum === null) !== (value.backupName === null) || typeof value.expectedOutputChecksum !== "string" || !/^sha256:[a-f0-9]{64}$/.test(value.expectedOutputChecksum)) throw new Error("malformed transaction journal");
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
  const records = text.length === 0 ? [] : text.trimEnd().split("\n").map((line) => JSON.parse(line) as unknown);
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
type ImportOwnerValue = { pid: number; nonce: string };
type ImportOwner = PublishedOwner<ImportOwnerValue>;
type LegacyOwnerIdentity = { dev: bigint; ino: bigint; mtimeMs: bigint; size: bigint };
const LEGACY_LOCK_GRACE_MS = 30_000;

class LiveImportLockError extends Error {}

function parseImportOwner(value: unknown): ImportOwnerValue {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).sort().join(",") !== "nonce,pid") {
    throw new Error("owner identity must contain exactly pid and nonce");
  }
  const owner = value as { pid?: unknown; nonce?: unknown };
  if (!Number.isInteger(owner.pid) || Number(owner.pid) <= 0 || typeof owner.nonce !== "string" || owner.nonce.length === 0) {
    throw new Error("owner identity is malformed");
  }
  return { pid: Number(owner.pid), nonce: owner.nonce };
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = error instanceof Error && "code" in error ? error.code : undefined;
    if (code === "ESRCH") return false;
    if (code === "EPERM") return true;
    throw error;
  }
}

function sameLegacyIdentity(path: string, expected: LegacyOwnerIdentity): boolean {
  try {
    const current = lstatSync(path, { bigint: true });
    return !current.isSymbolicLink() && current.isFile()
      && current.dev === expected.dev && current.ino === expected.ino
      && current.mtimeMs === expected.mtimeMs && current.size === expected.size;
  } catch {
    return false;
  }
}

function releaseImportOwner(releaseRoot: string, owner: ImportOwner, label: string): void {
  try {
    if (unlinkPublishedOwner(owner, label, parseImportOwner)) fsyncDirectory(releaseRoot, label);
  } catch {
    /* retain an owner whose identity cannot be proven */
  }
}

function publishImportOwner(
  releaseRoot: string,
  path: string,
  label: string,
  options: ImportLocalLoreOptions,
): ImportOwner | null {
  return publishAtomicOwner({
    directory: releaseRoot,
    path,
    label,
    value: { pid: process.pid, nonce: randomUUID() },
    parse: parseImportOwner,
    operations: options.operations,
  });
}

function replaceStaleArtifact(
  releaseRoot: string,
  path: string,
  label: string,
  identity: LegacyOwnerIdentity,
  options: ImportLocalLoreOptions,
  observed: ImportOwner | null = null,
): ImportOwner {
  if (observed && !samePublishedOwner(observed, label, parseImportOwner)) {
    throw new Error(`${label} owner changed before isolation`);
  }
  if (!sameLegacyIdentity(path, identity)) throw new Error(`${label} identity changed before isolation`);
  const tombstone = `${path}.stale-${randomUUID()}`;
  renameSync(path, tombstone);
  fsyncDirectory(releaseRoot, label);
  const isolatedOwner = observed ? { ...observed, path: tombstone } : null;
  let installed: ImportOwner | null = null;
  try {
    if (!sameLegacyIdentity(tombstone, identity)
        || (isolatedOwner && !samePublishedOwner(isolatedOwner, label, parseImportOwner))) {
      throw new Error(`${label} identity changed during isolation`);
    }
    installed = publishImportOwner(releaseRoot, path, label, options);
    if (!installed) throw new Error(`${label} changed during stale recovery`);
    return installed;
  } catch (error) {
    if (!installed && !existsSync(path) && sameLegacyIdentity(tombstone, identity)) {
      renameSync(tombstone, path);
      fsyncDirectory(releaseRoot, label);
    }
    throw error;
  } finally {
    if (installed && sameLegacyIdentity(tombstone, identity)
        && (!isolatedOwner || unlinkPublishedOwner(isolatedOwner, label, parseImportOwner))) {
      if (!isolatedOwner) unlinkSync(tombstone);
      fsyncDirectory(releaseRoot, label);
    }
  }
}

function inspectGuardDescriptor(guard: ImportOwner, options: ImportLocalLoreOptions): void {
  if (!options.operations?.inspectReclaimGuardFd) return;
  const descriptor = openSync(guard.path, "r");
  try {
    const stats = fstatSync(descriptor, { bigint: true });
    if (stats.dev !== guard.device || stats.ino !== guard.inode) throw new Error("reclaim guard identity mismatch");
    options.operations.inspectReclaimGuardFd(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function acquireReclaimGuard(releaseRoot: string, path: string, options: ImportLocalLoreOptions): ImportOwner {
  let guard = publishImportOwner(releaseRoot, path, "transaction lock reclaim guard", options);
  if (guard) {
    try {
      inspectGuardDescriptor(guard, options);
      return guard;
    } catch (error) {
      releaseImportOwner(releaseRoot, guard, "transaction lock reclaim guard");
      throw error;
    }
  }

  const stats = lstatSync(path, { bigint: true });
  if (stats.isSymbolicLink() || !stats.isFile()) throw new Error("transaction lock reclaim guard is not a regular file");
  let observed: ImportOwner | null = null;
  try {
    observed = observePublishedOwner(path, "transaction lock reclaim guard", parseImportOwner);
  } catch {
    if (Date.now() - Number(stats.mtimeMs) < LEGACY_LOCK_GRACE_MS) {
      throw new Error("transaction lock reclaim guard is malformed or recently incomplete");
    }
  }
  if (observed && processIsAlive(observed.value.pid)) throw new LiveImportLockError("lock reclaim is already active");

  const claimPath = `${path}-claim`;
  let claim = publishImportOwner(releaseRoot, claimPath, "transaction lock reclaim claim", options);
  if (!claim) {
    const claimIdentity = lstatSync(claimPath, { bigint: true });
    if (claimIdentity.isSymbolicLink() || !claimIdentity.isFile()) {
      throw new Error("transaction lock reclaim claim is not a regular file");
    }
    let observedClaim: ImportOwner | null = null;
    try {
      observedClaim = observePublishedOwner(claimPath, "transaction lock reclaim claim", parseImportOwner);
    } catch {
      if (Date.now() - Number(claimIdentity.mtimeMs) < LEGACY_LOCK_GRACE_MS) {
        throw new Error("transaction lock reclaim claim is malformed or recently incomplete");
      }
    }
    if (observedClaim && processIsAlive(observedClaim.value.pid)) {
      throw new LiveImportLockError("lock reclaim is already active");
    }
    claim = replaceStaleArtifact(
      releaseRoot, claimPath, "transaction lock reclaim claim", claimIdentity, options, observedClaim,
    );
  }
  try {
    if (!sameLegacyIdentity(path, stats)) throw new Error("transaction lock reclaim guard changed before recovery");
    if (observed && !samePublishedOwner(observed, "transaction lock reclaim guard", parseImportOwner)) {
      throw new Error("transaction lock reclaim guard owner changed before recovery");
    }
    if (observed && processIsAlive(observed.value.pid)) throw new LiveImportLockError("lock reclaim became active");
    guard = replaceStaleArtifact(releaseRoot, path, "transaction lock reclaim guard", stats, options, observed);
    inspectGuardDescriptor(guard, options);
    return guard;
  } finally {
    releaseImportOwner(releaseRoot, claim, "transaction lock reclaim claim");
  }
}

const OWNER_ARTIFACT_SUFFIX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function cleanupCandidateArtifacts(releaseRoot: string): void {
  const prefixes = [
    `${LOCK_NAME}.candidate-`,
    `${LOCK_NAME}-reclaim.candidate-`,
    `${LOCK_NAME}-reclaim-claim.candidate-`,
  ];
  let removed = false;
  for (const name of readdirSync(releaseRoot)) {
    const prefix = prefixes.find((candidate) => name.startsWith(candidate));
    if (!prefix || !name.endsWith(".tmp")
        || !OWNER_ARTIFACT_SUFFIX.test(name.slice(prefix.length, -".tmp".length))) continue;
    const path = join(releaseRoot, name);
    let observed: ImportOwner;
    try { observed = observePublishedOwner(path, "transaction lock candidate", parseImportOwner); }
    catch { continue; }
    if (!processIsAlive(observed.value.pid)
        && unlinkPublishedOwner(observed, "transaction lock candidate", parseImportOwner)) removed = true;
  }
  if (removed) fsyncDirectory(releaseRoot, "transaction lock candidate cleanup");
}

function cleanupTombstoneArtifacts(releaseRoot: string, options: ImportLocalLoreOptions): void {
  const prefixes = [
    `${LOCK_NAME}.stale-`,
    `${LOCK_NAME}-reclaim.stale-`,
    `${LOCK_NAME}-reclaim-claim.stale-`,
  ];
  const guard = acquireReclaimGuard(releaseRoot, join(releaseRoot, `${LOCK_NAME}-reclaim`), options);
  let removed = false;
  try {
    for (const name of readdirSync(releaseRoot)) {
      const prefix = prefixes.find((candidate) => name.startsWith(candidate));
      if (!prefix || !OWNER_ARTIFACT_SUFFIX.test(name.slice(prefix.length))) continue;
      const path = join(releaseRoot, name);
      let observed: ImportOwner;
      try { observed = observePublishedOwner(path, "transaction lock tombstone", parseImportOwner); }
      catch { continue; }
      if (!processIsAlive(observed.value.pid)
          && unlinkPublishedOwner(observed, "transaction lock tombstone", parseImportOwner)) removed = true;
    }
    if (removed) fsyncDirectory(releaseRoot, "transaction lock tombstone cleanup");
  } finally {
    releaseImportOwner(releaseRoot, guard, "transaction lock reclaim guard");
  }
}

function acquireLock(releaseRoot: string, options: ImportLocalLoreOptions): ImportOwner {
  const path = join(releaseRoot, LOCK_NAME);
  let installed = publishImportOwner(releaseRoot, path, "transaction lock", options);
  if (!installed) {
    const stats = lstatSync(path, { bigint: true });
    if (stats.isSymbolicLink() || !stats.isFile()) throw new Error("transaction lock is not a regular file");
    let observed: ImportOwner | null = null;
    try {
      observed = observePublishedOwner(path, "transaction lock", parseImportOwner);
    } catch {
      if (Date.now() - Number(stats.mtimeMs) < LEGACY_LOCK_GRACE_MS) {
        throw new Error("transaction lock is malformed or recently incomplete");
      }
    }
    if (observed && processIsAlive(observed.value.pid)) {
      throw new LiveImportLockError("another import or manual recovery is active");
    }

    const guard = acquireReclaimGuard(releaseRoot, `${path}-reclaim`, options);
    try {
      options.operations?.duringLockReclaim?.();
      if (!sameLegacyIdentity(path, stats)) throw new Error("lock identity changed during reclaim");
      if (observed) {
        if (!samePublishedOwner(observed, "transaction lock", parseImportOwner)) throw new Error("lock owner changed during reclaim");
        if (processIsAlive(observed.value.pid)) throw new LiveImportLockError("lock owner became active");
      }
      installed = replaceStaleArtifact(releaseRoot, path, "transaction lock", stats, options, observed);
    } finally {
      releaseImportOwner(releaseRoot, guard, "transaction lock reclaim guard");
    }
  }
  try {
    cleanupCandidateArtifacts(releaseRoot);
    cleanupTombstoneArtifacts(releaseRoot, options);
  } catch (error) {
    releaseImportOwner(releaseRoot, installed, "transaction lock");
    throw error;
  }
  return installed;
}

function releaseLock(lock: ImportOwner): void {
  releaseImportOwner(dirname(lock.path), lock, "transaction lock");
}

function recover(options: ImportLocalLoreOptions, context: ReturnType<typeof roots>): LocalImportReport | null {
  ensureDirectory(context.repositoryRoot, context.releaseRoot);
  const journalPath = join(context.releaseRoot, JOURNAL_NAME);
  if (!existsSync(journalPath)) return null;
  const journal = parseJournal(journalPath);
  const backup = journal.backupName ? join(context.releaseRoot, journal.backupName) : null;
  const staging = join(context.releaseRoot, journal.stagingName);
  const targetExists = existsSync(context.targetRoot); const backupExists = backup !== null && existsSync(backup); const stagingExists = existsSync(staging);
  const targetReport = targetExists ? validateOverlay(context.targetRoot) : null;
  const backupReport = backupExists ? validateOverlay(backup!) : null;
  const stagingReport = stagingExists ? validateOverlay(staging) : null;
  const targetIsNew = targetReport?.outputChecksum === journal.expectedOutputChecksum;
  const targetIsPrior = journal.priorOutputChecksum !== null && targetReport?.outputChecksum === journal.priorOutputChecksum;
  const backupIsPrior = journal.priorOutputChecksum !== null && backupReport?.outputChecksum === journal.priorOutputChecksum;
  const stagingIsNew = stagingReport?.outputChecksum === journal.expectedOutputChecksum;
  const committed = (): LocalImportReport => {
    const backupStateIsSafe = journal.priorOutputChecksum === null ? !backupExists : (!backupExists || backupIsPrior);
    if (!targetIsNew || !targetReport || stagingExists || !backupStateIsSafe) throw new Error("ambiguous committed state");
    if (backupExists) { try { cleanupBackup(backup!, options); } catch { return { ...targetReport, warnings: ["backup-cleanup-pending"] }; } }
    unlinkSync(journalPath); return targetReport;
  };
  if (targetIsPrior && !backupExists && stagingIsNew) { rmSync(staging, { recursive: true, force: true }); unlinkSync(journalPath); return null; }
  if (targetIsNew) return committed();
  if (journal.priorOutputChecksum === null) {
    if (!targetExists && !backupExists && stagingIsNew) { rmSync(staging, { recursive: true, force: true }); unlinkSync(journalPath); return null; }
    throw new Error("ambiguous no-prior recovery state");
  }
  if (!targetExists && backupIsPrior && (stagingIsNew || !stagingExists)) {
    renameSync(backup!, context.targetRoot); if (stagingExists) rmSync(staging, { recursive: true, force: true }); unlinkSync(journalPath); return null;
  }
  throw new Error("ambiguous recovery state");
}

function promote(options: ImportLocalLoreOptions, context: ReturnType<typeof roots>, output: string, report: LocalImportReport): LocalImportReport {
  ensureDirectory(context.repositoryRoot, context.releaseRoot);
  const staging = mkdtempSync(join(context.releaseRoot, ".normalized-staging-"));
  const stagingName = staging.slice(context.releaseRoot.length + 1);
  const backupName = `.normalized-backup-${randomUUID()}`;
  const backup = join(context.releaseRoot, backupName);
  const journalPath = join(context.releaseRoot, JOURNAL_NAME);
  let preserveArtifacts = false;
  const priorReport = existsSync(context.targetRoot) ? validateOverlay(context.targetRoot) : null;
  let journal: Journal = { schemaVersion: 1, phase: "prepared", targetName: "normalized", stagingName, backupName: priorReport ? backupName : null, priorOutputChecksum: priorReport?.outputChecksum ?? null, expectedOutputChecksum: report.outputChecksum! };
  try {
    writeFileSync(join(staging, "current.jsonl"), output, { mode: 0o600 }); writeJson(join(staging, "report.json"), report); validateOverlay(staging, report.outputChecksum!);
    atomicJson(journalPath, journal, options);
    if (existsSync(context.targetRoot)) {
      options.operations?.beforeBackupRename?.();
      const latestPrior = validateOverlay(context.targetRoot);
      if (latestPrior.outputChecksum !== journal.priorOutputChecksum) { preserveArtifacts = true; throw new Error("prior target changed before backup rename"); }
      renameSync(context.targetRoot, backup);
      const backedUpPrior = validateOverlay(backup);
      if (backedUpPrior.outputChecksum !== journal.priorOutputChecksum) { preserveArtifacts = true; throw new Error("backup does not match prior target"); }
      journal = { ...journal, phase: "backed-up" }; atomicJson(journalPath, journal, options);
    }
    try { options.operations?.beforePromote?.(context.targetRoot); } catch (error) { preserveArtifacts = true; throw error; }
    renameSync(staging, context.targetRoot); journal = { ...journal, phase: "promoted" }; atomicJson(journalPath, journal, options); validateOverlay(context.targetRoot, report.outputChecksum!);
  } catch {
    if (existsSync(backup) && !existsSync(context.targetRoot)) { renameSync(backup, context.targetRoot); if (existsSync(journalPath)) unlinkSync(journalPath); }
    throw new Error("promotion failed");
  } finally { if (!preserveArtifacts && existsSync(staging)) rmSync(staging, { recursive: true, force: true }); }
  if (existsSync(backup)) { try { cleanupBackup(backup, options); } catch { return { ...report, warnings: ["backup-cleanup-pending"] }; } }
  unlinkSync(journalPath); return report;
}

function materializeAdapterEntries(
  result: AdapterResult,
  manifest: ReturnType<typeof loadLocalLoreManifest>,
): LocalFullTextRecord[] {
  const records: LocalFullTextRecord[] = [];
  const logicalIds = new Set<string>();
  for (const entry of result.entries) {
    if (logicalIds.has(entry.input.logicalId)) throw new Error("duplicate adapter logicalId");
    logicalIds.add(entry.input.logicalId);
    records.push(materializeCanonicalLoreInput(entry.input, manifest, entry.sourcePath, entry.dependencyPaths));
  }
  validateLocalFullTextRecords(records);
  return records;
}

function runRegisteredAdapter(
  manifest: ReturnType<typeof loadLocalLoreManifest>,
  sourceRoot: string,
): AdapterResult {
  if (manifest.adapter === "saved-hoyowiki") return convertSavedHoyoWiki({ manifest, sourceRoot });
  if (manifest.adapter === "compatible-game-data") return convertCompatibleGameData({ manifest, sourceRoot });
  throw new Error("adapter is not source-specific");
}

function runImport(options: ImportLocalLoreOptions, context: ReturnType<typeof roots>): LocalImportReport {
  const persist = (report: LocalImportReport) => persistRejected(context.repositoryRoot, context.releaseRoot, report, options);
  try { const recovered = recover(options, context); if (recovered) return recovered; }
  catch { const report = rejected(options.releaseId, "recovery-failed", [], [], recoveryNames(context.releaseRoot)); persist(report); return report; }
  let manifest;
  try { manifest = loadLocalLoreManifest(options.manifestPath, options.releaseId, options.sourceRoot); }
  catch { const report = rejected(options.releaseId, "manifest-validation-failed"); persist(report); return report; }
  const checksums = manifest.files.map((file) => file.checksum); const paths = manifest.files.map((file) => file.path);
  let records: LocalFullTextRecord[];
  if (manifest.adapter === "canonical-jsonl") {
    if (manifest.files.length !== 1) { const report = rejected(options.releaseId, "adapter-unsupported", checksums, paths); persist(report); return report; }
    let text: string;
    try { text = readValidatedLocalLoreFile(manifest, options.sourceRoot, manifest.files[0].path).text; }
    catch { const report = rejected(options.releaseId, "source-validation-failed", checksums, paths); persist(report); return report; }
    try { records = parseCanonicalLoreJsonl(text, manifest); }
    catch { const report = rejected(options.releaseId, "canonical-validation-failed", checksums, paths); persist(report); return report; }
  } else {
    let adapterResult: AdapterResult;
    try { adapterResult = runRegisteredAdapter(manifest, options.sourceRoot); }
    catch { const report = rejected(options.releaseId, "source-validation-failed", checksums, paths); persist(report); return report; }
    if (adapterResult.rejections.length > 0) {
      const report = rejected(options.releaseId, "adapter-rejected", checksums, paths, [], adapterResult.rejections);
      persist(report);
      return report;
    }
    try { records = materializeAdapterEntries(adapterResult, manifest); }
    catch { const report = rejected(options.releaseId, "canonical-validation-failed", checksums, paths); persist(report); return report; }
  }
  const output = serializeCanonicalLoreRecords(records);
  const report: LocalImportReport = { status: "accepted", releaseId: options.releaseId, acceptedCount: records.length, rejectedCount: 0, inputChecksums: checksums, outputChecksum: sha(output), warnings: [], rejection: null };
  try { return promote(options, context, output, report); }
  catch { const failure = rejected(options.releaseId, "promotion-failed", checksums, paths, recoveryNames(context.releaseRoot)); persist(failure); return failure; }
}

export function importLocalLore(options: ImportLocalLoreOptions): LocalImportReport {
  const context = roots(options);
  ensureDirectory(context.repositoryRoot, context.releaseRoot);
  let lock: ImportOwner;
  try { lock = acquireLock(context.releaseRoot, options); }
  catch (error) {
    const report = rejected(options.releaseId, "recovery-failed", [], [], [LOCK_NAME, ...recoveryNames(context.releaseRoot)]);
    if (!(error instanceof LiveImportLockError)) persistRejected(context.repositoryRoot, context.releaseRoot, report, options);
    return report;
  }
  try { return runImport(options, context); } finally { releaseLock(lock); }
}
