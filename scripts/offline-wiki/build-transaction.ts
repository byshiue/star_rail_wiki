import { createHash, randomUUID } from "node:crypto";
import {
  closeSync, constants, fsyncSync, linkSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readdirSync,
  realpathSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync, type Stats,
} from "node:fs";
import { basename, dirname, join, parse, resolve, sep } from "node:path";
import { z } from "zod";
import { readBuildManifest, verifyBuildRoot, type BuildManifest } from "./verify";

export type BuildTransactionPhase = "prepared" | "backed-up" | "promoted" | "cleanup-pending";
export type BuildTransactionOperations = {
  removeBackup?: (path: string) => void;
  afterBackupRename?: () => void;
  afterPromoteRename?: () => void;
  afterJournalPhase?: (phase: BuildTransactionPhase) => void;
  duringLockReclaim?: () => void;
};

type DirectoryIdentity = { path: string; device: number | bigint; inode: number | bigint };
type Lock = DirectoryIdentity & { nonce: string };
type OwnerIdentity = { path: string; device: bigint; inode: bigint; pid: number; nonce: string; mtimeMs: number };
type Journal = {
  schemaVersion: 1; releaseId: string; phase: BuildTransactionPhase; targetName: string;
  stagingName: string; backupName: string | null; expectedManifestChecksum: string; priorManifestChecksum: string | null;
};
type Context = { builds: DirectoryIdentity; releaseId: string; finalRoot: string; journalPath: string; operations?: BuildTransactionOperations };

const CHECKSUM = /^sha256:[a-f0-9]{64}$/u;
const OWNER_NONCE = /^[0-9a-f-]{36}$/u;
const LEGACY_MALFORMED_GRACE_MS = 60_000;
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
function lockName(releaseId: string): string { return `.${releaseId}.build-transaction.lock`; }
function safeSuffix(value: string): boolean { return /^[A-Za-z0-9-]+$/u.test(value); }
function assertStagingName(releaseId: string, name: string): void {
  const prefix = stagingPrefix(releaseId); if (!name.startsWith(prefix) || !safeSuffix(name.slice(prefix.length))) throw new Error("malformed staging basename");
}
function assertBackupName(releaseId: string, name: string): void {
  const prefix = backupPrefix(releaseId); if (!name.startsWith(prefix) || !safeSuffix(name.slice(prefix.length))) throw new Error("malformed backup basename");
}
function fsyncDirectory(path: string): void { const fd = openSync(path, constants.O_RDONLY); try { fsyncSync(fd); } finally { closeSync(fd); } }
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

function ownerContent(path: string, label: string): { pid: number; nonce: string } {
  const stats = lstatSync(path); if (stats.isSymbolicLink() || !stats.isFile() || stats.size > 4096) throw new Error(`${label} is not a safe regular file`);
  let value: Record<string, unknown>;
  try { value = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>; }
  catch { throw new Error(`${label} is malformed`); }
  if (Object.keys(value).sort().join(",") !== "nonce,pid" || !Number.isInteger(value.pid) || (value.pid as number) <= 0 || typeof value.nonce !== "string" || !OWNER_NONCE.test(value.nonce)) throw new Error(`${label} is malformed`);
  return value as { pid: number; nonce: string };
}
function observeOwner(path: string, label: string): OwnerIdentity {
  const stats = lstatSync(path, { bigint: true }); const owner = ownerContent(path, label);
  return { path, device: stats.dev, inode: stats.ino, pid: owner.pid, nonce: owner.nonce, mtimeMs: Number(stats.mtimeMs) };
}
function sameIdentity(path: string, expected: Pick<OwnerIdentity, "device" | "inode">): boolean {
  const stats = lstatMaybe(path); return stats !== null && !stats.isSymbolicLink() && stats.isFile()
    && BigInt(stats.dev) === expected.device && BigInt(stats.ino) === expected.inode;
}
function sameOwner(path: string, expected: OwnerIdentity, label: string): boolean {
  if (!sameIdentity(path, expected)) return false;
  try { const owner = ownerContent(path, label); return owner.pid === expected.pid && owner.nonce === expected.nonce; }
  catch { return false; }
}
function unlinkOwned(path: string, expected: OwnerIdentity, label: string): boolean {
  if (!sameOwner(path, expected, label)) return false;
  unlinkSync(path); return true;
}
function publishOwner(builds: DirectoryIdentity, path: string, label: string, nonce = randomUUID()): OwnerIdentity | null {
  assertParent(builds); const temporary = `${path}.candidate-${nonce}.tmp`; let descriptor: number | null = null; let candidate: OwnerIdentity | null = null;
  try {
    descriptor = openSync(temporary, "wx", 0o600); writeFileSync(descriptor, JSON.stringify({ pid: process.pid, nonce })); fsyncSync(descriptor);
    closeSync(descriptor); descriptor = null; candidate = observeOwner(temporary, `${label} candidate`); assertParent(builds);
    try { linkSync(temporary, path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") return null; throw error; }
    fsyncDirectory(builds.path);
    if (!sameOwner(path, candidate, label)) throw new Error(`${label} publish identity mismatch`);
    unlinkOwned(temporary, candidate, `${label} candidate`); fsyncDirectory(builds.path);
    return observeOwner(path, label);
  } finally {
    if (descriptor !== null) closeSync(descriptor);
    if (candidate && unlinkOwned(temporary, candidate, `${label} candidate`)) fsyncDirectory(builds.path);
  }
}
function isolateOwner(builds: DirectoryIdentity, observed: OwnerIdentity, label: string): string {
  assertParent(builds);
  if (!sameOwner(observed.path, observed, label)) throw new Error(`${label} owner changed before isolation`);
  const tombstone = `${observed.path}.stale-${randomUUID()}`; renameSync(observed.path, tombstone); fsyncDirectory(builds.path);
  if (!sameOwner(tombstone, observed, label)) throw new Error(`${label} replacement was isolated; refusing to delete it`);
  return tombstone;
}
function restoreOrRemoveTombstone(builds: DirectoryIdentity, tombstone: string, canonical: string, observed: OwnerIdentity, installed: boolean, label: string): void {
  if (!sameOwner(tombstone, observed, label)) return;
  if (!installed) {
    try { linkSync(tombstone, canonical); fsyncDirectory(builds.path); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
  }
  if (unlinkOwned(tombstone, { ...observed, path: tombstone }, label)) fsyncDirectory(builds.path);
}
function processIsAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ESRCH") return false; throw error; }
}
function replaceDeadOwner(builds: DirectoryIdentity, observed: OwnerIdentity, label: string): OwnerIdentity {
  if (processIsAlive(observed.pid)) throw new Error(`${label} is active`);
  const tombstone = isolateOwner(builds, observed, label); let installed: OwnerIdentity | null = null;
  try {
    installed = publishOwner(builds, observed.path, label);
    if (!installed) throw new Error(`${label} changed during stale recovery`);
    return installed;
  } finally { restoreOrRemoveTombstone(builds, tombstone, observed.path, observed, installed !== null, label); }
}
function acquireReclaimGuard(builds: DirectoryIdentity, guardPath: string): OwnerIdentity {
  const claimPath = `${guardPath}-claim`; let claim = publishOwner(builds, claimPath, "build lock reclaim claim");
  if (!claim) {
    const staleClaim = observeOwner(claimPath, "build lock reclaim claim");
    claim = replaceDeadOwner(builds, staleClaim, "build lock reclaim claim");
  }
  try {
    let guard = publishOwner(builds, guardPath, "build lock reclaim guard");
    if (!guard) {
      const staleGuard = observeOwner(guardPath, "build lock reclaim guard");
      guard = replaceDeadOwner(builds, staleGuard, "build lock reclaim guard");
    }
    return guard;
  } finally { releaseOwner(claim, "build lock reclaim claim", builds); }
}
function releaseOwner(owner: OwnerIdentity, label: string, builds?: DirectoryIdentity): void {
  try { if (unlinkOwned(owner.path, owner, label) && builds) fsyncDirectory(builds.path); }
  catch { /* retain an unverified or replaced owner file */ }
}
function cleanupCandidateArtifacts(builds: DirectoryIdentity, releaseId: string): void {
  const lock = lockName(releaseId); const prefixes = [`${lock}.candidate-`, `${lock}-reclaim.candidate-`, `${lock}-reclaim-claim.candidate-`];
  for (const name of readdirSync(builds.path).filter((entry) => prefixes.some((prefix) => entry.startsWith(prefix)))) {
    if (!/\.candidate-[0-9a-f-]{36}\.tmp$/u.test(name)) continue;
    const path = join(builds.path, name); let observed: OwnerIdentity;
    try { observed = observeOwner(path, "build lock candidate"); }
    catch {
      const stats = lstatSync(path, { bigint: true });
      if (stats.isSymbolicLink() || !stats.isFile() || Date.now() - Number(stats.mtimeMs) < LEGACY_MALFORMED_GRACE_MS) continue;
      const identity = { device: stats.dev, inode: stats.ino }; if (sameIdentity(path, identity)) unlinkSync(path);
      continue;
    }
    if (!processIsAlive(observed.pid)) unlinkOwned(path, observed, "build lock candidate");
  }
  fsyncDirectory(builds.path);
}
function acquireLock(builds: DirectoryIdentity, releaseId: string, operations?: BuildTransactionOperations): Lock {
  assertParent(builds); const path = join(builds.path, lockName(releaseId)); let installed = publishOwner(builds, path, "build lock");
  if (!installed) {
    const originalStats = lstatSync(path, { bigint: true }); let original: OwnerIdentity | null = null;
    try { original = observeOwner(path, "build lock"); }
    catch {
      if (originalStats.isSymbolicLink() || !originalStats.isFile() || Date.now() - Number(originalStats.mtimeMs) < LEGACY_MALFORMED_GRACE_MS) throw new Error("build lock is malformed or recently incomplete");
    }
    if (original && processIsAlive(original.pid)) throw new Error("another PDF build lock is active");
    const guard = acquireReclaimGuard(builds, `${path}-reclaim`); let tombstone: string | null = null;
    try {
      operations?.duringLockReclaim?.(); assertParent(builds);
      if (!sameOwner(guard.path, guard, "build lock reclaim guard")) throw new Error("build lock reclaim guard changed after acquisition");
      if (original) {
        if (!sameOwner(path, original, "build lock") || processIsAlive(original.pid)) throw new Error("build lock owner changed during reclaim");
        tombstone = isolateOwner(builds, original, "build lock");
      } else {
        const current = lstatSync(path, { bigint: true });
        if (current.dev !== originalStats.dev || current.ino !== originalStats.ino || current.isSymbolicLink() || !current.isFile()
            || Date.now() - Number(current.mtimeMs) < LEGACY_MALFORMED_GRACE_MS) throw new Error("legacy build lock changed during reclaim");
        tombstone = `${path}.stale-${randomUUID()}`; renameSync(path, tombstone); fsyncDirectory(builds.path);
        const isolated = lstatSync(tombstone, { bigint: true });
        if (isolated.dev !== originalStats.dev || isolated.ino !== originalStats.ino) throw new Error("legacy build lock replacement was isolated; refusing to delete it");
      }
      installed = publishOwner(builds, path, "build lock");
      if (!installed) throw new Error("build lock changed during reclaim");
      if (tombstone) {
        const tomb = lstatMaybe(tombstone);
        if (original) restoreOrRemoveTombstone(builds, tombstone, path, original, true, "build lock");
        else if (tomb && !tomb.isSymbolicLink() && tomb.isFile() && BigInt(tomb.dev) === originalStats.dev && BigInt(tomb.ino) === originalStats.ino) { unlinkSync(tombstone); fsyncDirectory(builds.path); }
      }
    } finally { releaseOwner(guard, "build lock reclaim guard", builds); }
  }
  cleanupCandidateArtifacts(builds, releaseId);
  return { path, device: installed.device, inode: installed.inode, nonce: installed.nonce };
}
function releaseLock(lock: Lock): void {
  try {
    const stats = lstatSync(lock.path, { bigint: true }); const owner = ownerContent(lock.path, "build lock");
    if (!stats.isSymbolicLink() && stats.isFile() && stats.dev === lock.device && stats.ino === lock.inode && owner.nonce === lock.nonce) unlinkSync(lock.path);
  } catch { /* retain an unverified or replaced lock */ }
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
  const context = buildContext(options.outputRoot, options.releaseId, options.operations); const lock = acquireLock(context.builds, context.releaseId, context.operations);
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
