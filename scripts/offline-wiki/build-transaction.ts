import { createHash, randomUUID } from "node:crypto";
import {
  closeSync, constants, fsyncSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync,
  realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync, type Stats,
} from "node:fs";
import { basename, dirname, join, parse, resolve, sep } from "node:path";
import { z } from "zod";
import { fsyncDirectory as fsyncAtomicDirectory } from "./atomic-owner";
import { acquireOwnershipSync, releaseOwnership, type OwnershipHandle } from "./advisory-lock";
import { readBuildManifest, verifyBuildRoot, type BuildManifest } from "./verify";

export type BuildTransactionPhase = "prepared" | "backed-up" | "promoted" | "cleanup-pending";
export type BuildTransactionOperations = {
  removeBackup?: (path: string) => void;
  afterBackupRename?: () => void;
  afterPromoteRename?: () => void;
  afterJournalPhase?: (phase: BuildTransactionPhase) => void;
};

type DirectoryIdentity = { path: string; device: number | bigint; inode: number | bigint };
type Lock = Extract<OwnershipHandle, { outcome: "acquired" }>;
type Journal = {
  schemaVersion: 1; releaseId: string; phase: BuildTransactionPhase; targetName: string;
  stagingName: string; backupName: string | null; expectedManifestChecksum: string; priorManifestChecksum: string | null;
};
type Context = { builds: DirectoryIdentity; releaseId: string; finalRoot: string; journalPath: string; operations?: BuildTransactionOperations };

const CHECKSUM = /^sha256:[a-f0-9]{64}$/u;
const JournalSchema = z.strictObject({
  schemaVersion: z.literal(1), releaseId: z.string().min(1),
  phase: z.enum(["prepared", "backed-up", "promoted", "cleanup-pending"]),
  targetName: z.string().min(1), stagingName: z.string().min(1), backupName: z.string().min(1).nullable(),
  expectedManifestChecksum: z.string().regex(CHECKSUM), priorManifestChecksum: z.string().regex(CHECKSUM).nullable(),
});

function sha(bytes: Uint8Array): string { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }
function lstatMaybe(path: string): Stats | null {
  try { return lstatSync(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
function ensureCanonicalDirectory(path: string): string {
  const absolute = resolve(path); const root = parse(absolute).root; let current = root;
  for (const component of absolute.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, component); const stats = lstatMaybe(current);
    if (stats) { if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error(`canonical directory contains a symlink or non-directory: ${current}`); }
    else mkdirSync(current, { mode: 0o700 });
    if (realpathSync(current) !== current) throw new Error(`directory is not canonical: ${current}`);
  }
  return absolute;
}
function captureDirectory(path: string): DirectoryIdentity {
  const canonical = ensureCanonicalDirectory(path); const stats = statSync(canonical, { bigint: true });
  return { path: canonical, device: stats.dev, inode: stats.ino };
}
function assertParent(identity: DirectoryIdentity): void {
  const stats = lstatSync(identity.path, { bigint: true });
  if (stats.isSymbolicLink() || !stats.isDirectory() || realpathSync(identity.path) !== identity.path || stats.dev !== identity.device || stats.ino !== identity.inode) {
    throw new Error("builds parent identity changed or is not canonical");
  }
}
function assertChild(context: Context, path: string, expectedName: string, mustExist: boolean): void {
  assertParent(context.builds);
  if (dirname(resolve(path)) !== context.builds.path || basename(path) !== expectedName) throw new Error("transaction artifact is not an expected builds sibling");
  const stats = lstatMaybe(path);
  if (!mustExist) { if (stats) throw new Error(`transaction artifact already exists: ${expectedName}`); return; }
  if (!stats || stats.isSymbolicLink() || !stats.isDirectory() || dirname(realpathSync(path)) !== context.builds.path) throw new Error(`transaction artifact is not a canonical real directory: ${expectedName}`);
}
function stagingPrefix(releaseId: string): string { return `.${releaseId}.staging-`; }
function backupPrefix(releaseId: string): string { return `${releaseId}.backup-`; }
function journalName(releaseId: string): string { return `.${releaseId}.build-transaction.json`; }
function safeSuffix(value: string): boolean { return /^[A-Za-z0-9-]+$/u.test(value); }
function assertStagingName(releaseId: string, name: string): void {
  const prefix = stagingPrefix(releaseId); if (!name.startsWith(prefix) || !safeSuffix(name.slice(prefix.length))) throw new Error("malformed staging basename");
}
function assertBackupName(releaseId: string, name: string): void {
  const prefix = backupPrefix(releaseId); if (!name.startsWith(prefix) || !safeSuffix(name.slice(prefix.length))) throw new Error("malformed backup basename");
}
function fsyncDirectory(path: string): void { fsyncAtomicDirectory(path, "PDF build transaction"); }
function atomicJson(context: Context, path: string, value: unknown): void {
  assertParent(context.builds); if (dirname(resolve(path)) !== context.builds.path) throw new Error("journal path escapes builds root");
  const temporary = `${path}.${randomUUID()}.tmp`; let descriptor: number | null = null;
  try {
    descriptor = openSync(temporary, "wx", 0o600); writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`); fsyncSync(descriptor);
    closeSync(descriptor); descriptor = null; assertParent(context.builds);
    const current = lstatMaybe(path); if (current && (current.isSymbolicLink() || !current.isFile())) throw new Error("journal target is unsafe");
    renameSync(temporary, path); fsyncDirectory(context.builds.path);
  } finally {
    if (descriptor !== null) closeSync(descriptor); const stats = lstatMaybe(temporary);
    if (stats?.isFile() && !stats.isSymbolicLink()) unlinkSync(temporary);
  }
}
function writeJournal(context: Context, journal: Journal): void { atomicJson(context, context.journalPath, journal); context.operations?.afterJournalPhase?.(journal.phase); }
function parseJournal(context: Context): Journal {
  const stats = lstatSync(context.journalPath);
  if (stats.isSymbolicLink() || !stats.isFile() || stats.size > 16 * 1024) throw new Error("malformed build transaction journal");
  let value: Journal;
  try { value = JournalSchema.parse(JSON.parse(readFileSync(context.journalPath, "utf8"))); } catch { throw new Error("malformed build transaction journal"); }
  if (value.releaseId !== context.releaseId || value.targetName !== context.releaseId) throw new Error("journal release target mismatch");
  assertStagingName(context.releaseId, value.stagingName); if (value.backupName !== null) assertBackupName(context.releaseId, value.backupName);
  if ((value.backupName === null) !== (value.priorManifestChecksum === null)) throw new Error("journal prior identity is inconsistent");
  if ((value.phase === "backed-up" || value.phase === "cleanup-pending") && value.backupName === null) throw new Error("journal phase requires a prior backup");
  return value;
}
function manifestChecksum(root: string): string { return sha(readFileSync(join(root, "build-manifest.json"))); }
function verifiedManifest(context: Context, root: string, name: string, expected?: string): BuildManifest {
  assertChild(context, root, name, true); verifyBuildRoot(root, context.releaseId);
  if (expected && manifestChecksum(root) !== expected) throw new Error(`build manifest identity mismatch: ${name}`);
  return readBuildManifest(root);
}
function removeDirectory(context: Context, root: string, name: string, operation?: (path: string) => void): void {
  assertChild(context, root, name, true); (operation ?? ((path) => rmSync(path, { recursive: true, force: false })))(root); fsyncDirectory(context.builds.path);
}
function unlinkJournal(context: Context): void {
  assertParent(context.builds); const stats = lstatSync(context.journalPath);
  if (stats.isSymbolicLink() || !stats.isFile()) throw new Error("journal is unsafe before unlink");
  unlinkSync(context.journalPath); fsyncDirectory(context.builds.path);
}
function setManifestWarnings(context: Context, root: string, warnings: BuildManifest["warnings"]): BuildManifest {
  const updated = { ...readBuildManifest(root), warnings }; const path = join(root, "build-manifest.json"); const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(updated, null, 2)}\n`, { flag: "wx" });
    assertChild(context, root, basename(root), true);
    const target = lstatSync(path); const candidate = lstatSync(temporary);
    if (target.isSymbolicLink() || !target.isFile() || candidate.isSymbolicLink() || !candidate.isFile()) throw new Error("manifest warning update target is unsafe");
    renameSync(temporary, path);
  }
  finally { const stats = lstatMaybe(temporary); if (stats?.isFile() && !stats.isSymbolicLink()) unlinkSync(temporary); }
  verifyBuildRoot(root, context.releaseId); return updated;
}

function acquireLock(builds: DirectoryIdentity, releaseId: string): Lock {
  const result = acquireOwnershipSync({ directory: builds.path, kind: "pdf", releaseId });
  if (result.outcome === "acquired") return result;
  throw new Error(`another PDF build lock is active or unavailable: ${result.reason}`);
}
function releaseLock(lock: Lock): void {
  releaseOwnership(lock);
}

function scanArtifacts(context: Context): { backups: string[]; staging: string[] } {
  assertParent(context.builds); const names = readdirSync(context.builds.path);
  const backups = names.filter((name) => name.startsWith(backupPrefix(context.releaseId)));
  const staging = names.filter((name) => name.startsWith(stagingPrefix(context.releaseId)));
  backups.forEach((name) => assertBackupName(context.releaseId, name)); staging.forEach((name) => assertStagingName(context.releaseId, name));
  for (const name of [...backups, ...staging]) { const stats = lstatSync(join(context.builds.path, name)); if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error("transaction artifact is an unsafe symlink or non-directory"); }
  return { backups, staging };
}
function cleanupOrphanStaging(context: Context): void { for (const name of scanArtifacts(context).staging) removeDirectory(context, join(context.builds.path, name), name); }
function cleanupCommitted(context: Context, journal: Journal, manifest: BuildManifest): BuildManifest | null {
  if (journal.backupName) {
    const backup = join(context.builds.path, journal.backupName);
    if (lstatMaybe(backup)) {
      try { removeDirectory(context, backup, journal.backupName, context.operations?.removeBackup); }
      catch {
        if (journal.phase !== "cleanup-pending") writeJournal(context, { ...journal, phase: "cleanup-pending" });
        return setManifestWarnings(context, context.finalRoot, ["backup-cleanup-pending"]);
      }
    }
  }
  unlinkJournal(context); if (manifest.warnings.length > 0) setManifestWarnings(context, context.finalRoot, []); return null;
}
function recoverJournal(context: Context): BuildManifest | null {
  const journal = parseJournal(context); const artifacts = scanArtifacts(context);
  if (artifacts.backups.some((name) => name !== journal.backupName)) throw new Error("ambiguous backups outside transaction journal");
  const stagingRoot = join(context.builds.path, journal.stagingName); const backupRoot = journal.backupName ? join(context.builds.path, journal.backupName) : null;
  const finalExists = lstatMaybe(context.finalRoot) !== null; const stagingExists = lstatMaybe(stagingRoot) !== null; const backupExists = backupRoot !== null && lstatMaybe(backupRoot) !== null;
  let finalManifest: BuildManifest | null = null; let finalExpected = false; let finalPrior = false;
  if (finalExists) {
    finalManifest = verifiedManifest(context, context.finalRoot, context.releaseId); const identity = manifestChecksum(context.finalRoot);
    finalExpected = identity === journal.expectedManifestChecksum; finalPrior = identity === journal.priorManifestChecksum;
    if (!finalExpected && !finalPrior) throw new Error("active final does not match journal identities");
  }
  let stagingExpected = false;
  if (stagingExists) { verifiedManifest(context, stagingRoot, journal.stagingName, journal.expectedManifestChecksum); stagingExpected = true; }
  if (finalExpected && finalManifest) {
    if (stagingExists) throw new Error("ambiguous committed transaction retains staging");
    if (backupExists && (journal.phase === "prepared" || journal.phase === "backed-up")) verifiedManifest(context, backupRoot!, journal.backupName!, journal.priorManifestChecksum!);
    return cleanupCommitted(context, journal, finalManifest);
  }
  if (!finalExists && journal.priorManifestChecksum !== null && backupExists) {
    verifiedManifest(context, backupRoot!, journal.backupName!, journal.priorManifestChecksum);
    if (stagingExists && !stagingExpected) throw new Error("staging does not match expected build");
    assertChild(context, backupRoot!, journal.backupName!, true); assertChild(context, context.finalRoot, context.releaseId, false);
    renameSync(backupRoot!, context.finalRoot); fsyncDirectory(context.builds.path);
    if (stagingExists) removeDirectory(context, stagingRoot, journal.stagingName); unlinkJournal(context); return null;
  }
  if (finalPrior && finalManifest && !backupExists && stagingExpected && journal.phase === "prepared") { removeDirectory(context, stagingRoot, journal.stagingName); unlinkJournal(context); return null; }
  if (!finalExists && journal.priorManifestChecksum === null && !backupExists && stagingExpected && journal.phase === "prepared") { removeDirectory(context, stagingRoot, journal.stagingName); unlinkJournal(context); return null; }
  throw new Error("ambiguous build transaction recovery state");
}
function recoverLegacy(context: Context): void {
  const backups = scanArtifacts(context).backups; if (backups.length > 1) throw new Error("ambiguous legacy backups; refusing to delete anything");
  const finalExists = lstatMaybe(context.finalRoot) !== null; let active = finalExists ? verifiedManifest(context, context.finalRoot, context.releaseId) : null;
  if (backups.length === 1) {
    const name = backups[0]!; const root = join(context.builds.path, name); verifiedManifest(context, root, name);
    if (!finalExists) { assertChild(context, root, name, true); assertChild(context, context.finalRoot, context.releaseId, false); renameSync(root, context.finalRoot); fsyncDirectory(context.builds.path); active = readBuildManifest(context.finalRoot); }
    else removeDirectory(context, root, name);
  }
  if (active?.warnings.includes("backup-cleanup-pending")) setManifestWarnings(context, context.finalRoot, []);
}
function recover(context: Context): BuildManifest | null {
  const journal = lstatMaybe(context.journalPath);
  if (journal) { if (journal.isSymbolicLink() || !journal.isFile()) throw new Error("build transaction journal is unsafe"); const pending = recoverJournal(context); if (pending) return pending; }
  else recoverLegacy(context);
  cleanupOrphanStaging(context); return null;
}
function buildContext(outputRoot: string, releaseId: string, operations?: BuildTransactionOperations): Context {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(releaseId)) throw new Error("releaseId must be a safe single path component");
  const output = ensureCanonicalDirectory(outputRoot); const builds = captureDirectory(join(output, "builds"));
  return { builds, releaseId, finalRoot: join(builds.path, releaseId), journalPath: join(builds.path, journalName(releaseId)), operations };
}

export async function runBuildTransaction(options: {
  outputRoot: string; releaseId: string; operations?: BuildTransactionOperations;
  buildStaging: (stagingRoot: string, replacingExisting: boolean) => Promise<BuildManifest>;
}): Promise<BuildManifest> {
  const context = buildContext(options.outputRoot, options.releaseId, options.operations); const lock = acquireLock(context.builds, context.releaseId);
  try {
    const pending = recover(context); if (pending) return pending;
    const priorExists = lstatMaybe(context.finalRoot) !== null; const prior = priorExists ? verifiedManifest(context, context.finalRoot, context.releaseId) : null;
    const priorChecksum = prior ? manifestChecksum(context.finalRoot) : null; assertParent(context.builds);
    const stagingRoot = mkdtempSync(join(context.builds.path, stagingPrefix(context.releaseId))); const stagingName = basename(stagingRoot);
    assertStagingName(context.releaseId, stagingName); assertChild(context, stagingRoot, stagingName, true);
    try {
      const manifest = await options.buildStaging(stagingRoot, prior !== null); verifiedManifest(context, stagingRoot, stagingName);
      const expectedChecksum = manifestChecksum(stagingRoot); const backupName = prior ? `${backupPrefix(context.releaseId)}${randomUUID()}` : null;
      let journal: Journal = { schemaVersion: 1, releaseId: context.releaseId, phase: "prepared", targetName: context.releaseId, stagingName, backupName, expectedManifestChecksum: expectedChecksum, priorManifestChecksum: priorChecksum };
      writeJournal(context, journal);
      if (prior && backupName) {
        const backupRoot = join(context.builds.path, backupName); verifiedManifest(context, context.finalRoot, context.releaseId, priorChecksum!); assertChild(context, backupRoot, backupName, false);
        renameSync(context.finalRoot, backupRoot); fsyncDirectory(context.builds.path); context.operations?.afterBackupRename?.();
        verifiedManifest(context, backupRoot, backupName, priorChecksum!); journal = { ...journal, phase: "backed-up" }; writeJournal(context, journal);
      }
      assertChild(context, stagingRoot, stagingName, true); assertChild(context, context.finalRoot, context.releaseId, false);
      renameSync(stagingRoot, context.finalRoot); fsyncDirectory(context.builds.path); context.operations?.afterPromoteRename?.();
      const promoted = verifiedManifest(context, context.finalRoot, context.releaseId, expectedChecksum); journal = { ...journal, phase: "promoted" }; writeJournal(context, journal);
      const cleanupPending = cleanupCommitted(context, journal, promoted); if (cleanupPending) return cleanupPending;
      return promoted.warnings.length > 0 ? setManifestWarnings(context, context.finalRoot, []) : promoted;
    } finally {
      if (!lstatMaybe(context.journalPath) && lstatMaybe(stagingRoot)) removeDirectory(context, stagingRoot, stagingName);
    }
  } finally { releaseLock(lock); }
}
