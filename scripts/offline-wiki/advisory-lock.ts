import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  closeSync, constants, existsSync, fstatSync, fsyncSync, linkSync, lstatSync,
  openSync, readFileSync, readSync, realpathSync, unlinkSync, writeSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FLOCK = "/usr/bin/flock";
const WORKER = resolve(dirname(fileURLToPath(import.meta.url)), "ownership-worker.mjs");
const MUTEX_NAME = ".ownership-worker.mutex";
const MUTEX_MARKER = "star-rail-ownership-mutex-v1\n";
const MAX_RESULT_BYTES = 4096;
const SAFE_RELEASE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$/;

export const OWNERSHIP_WORKER_EXIT_CODES = [64, 65, 70, 74, 75] as const;
export type ProcessIdentity = { platform: "linux"; bootId: string; startTimeTicks: string };
export type OwnershipOwner = {
  pid: number; nonce: string; processIdentity: ProcessIdentity; device: string; inode: string;
};
export type OwnershipHandle = {
  outcome: "acquired"; reason: null; owner: OwnershipOwner; directory: string; ownerPath: string;
} | {
  outcome: "busy" | "denied"; reason: "flock-contention" | "live-owner" | "legacy-owner-active" | "malformed-recent" | "nfs-unqualified"; owner: null;
};

type WorkerResult = {
  schemaVersion: 1; token: string; outcome: "acquired" | "busy" | "denied";
  owner: OwnershipOwner | null;
  reason: null | "live-owner" | "legacy-owner-active" | "malformed-recent" | "nfs-unqualified";
};

function fsyncDirectory(path: string): void {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

function processIdentity(pid: number): ProcessIdentity {
  const bootId = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  const closeParen = stat.lastIndexOf(")");
  const startTimeTicks = closeParen < 0 ? "" : stat.slice(closeParen + 2).split(" ")[19];
  if (!/^[1-9][0-9]*$/.test(startTimeTicks)) throw new Error("Linux process identity is unavailable");
  return { platform: "linux", bootId, startTimeTicks };
}

function ownerName(kind: "import" | "pdf", releaseId: string): string {
  return kind === "import" ? ".normalized-transaction.lock" : `.${releaseId}.build-transaction.lock`;
}

function samePathIdentity(path: string, expected: { dev: bigint; ino: bigint }, regular: boolean): boolean {
  try {
    const current = lstatSync(path, { bigint: true });
    return !current.isSymbolicLink() && (regular ? current.isFile() : current.isDirectory())
      && current.dev === expected.dev && current.ino === expected.ino;
  } catch { return false; }
}

function initializeMutex(directory: string) {
  const path = join(directory, MUTEX_NAME);
  if (!existsSync(path)) {
    const candidate = `${path}.candidate-${randomUUID()}.tmp`;
    let descriptor: number | null = null;
    try {
      descriptor = openSync(candidate, constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_WRONLY, 0o600);
      const bytes = Buffer.from(MUTEX_MARKER);
      if (writeSync(descriptor, bytes, 0, bytes.length, 0) !== bytes.length) throw new Error("short mutex marker write");
      fsyncSync(descriptor); closeSync(descriptor); descriptor = null;
      try { linkSync(candidate, path); fsyncDirectory(directory); }
      catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      }
    } finally {
      if (descriptor !== null) closeSync(descriptor);
      try { unlinkSync(candidate); fsyncDirectory(directory); } catch { /* retain only ambiguous candidate */ }
    }
  }
  let descriptor: number;
  try { descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch { throw new Error("permanent ownership mutex is unsafe"); }
  try {
    const stats = fstatSync(descriptor, { bigint: true });
    const marker = Buffer.alloc(Buffer.byteLength(MUTEX_MARKER));
    if (!stats.isFile() || stats.size !== BigInt(marker.length) || (stats.mode & 0o777n) !== 0o600n
        || readSync(descriptor, marker, 0, marker.length, 0) !== marker.length
        || marker.toString("utf8") !== MUTEX_MARKER || !samePathIdentity(path, stats, true)) {
      throw new Error("permanent ownership mutex is unsafe");
    }
    return { path, descriptor, stats };
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
}

function cleanupAttemptOwner(input: {
  directory: string; path: string; nonce: string; identity: ProcessIdentity; published: OwnershipOwner | null;
}): void {
  try {
    const stats = lstatSync(input.path, { bigint: true });
    if (stats.isSymbolicLink() || !stats.isFile() || stats.size < 1n || stats.size > BigInt(MAX_RESULT_BYTES)) return;
    if (input.published
        && (String(stats.dev) !== input.published.device || String(stats.ino) !== input.published.inode)) return;
    const value: unknown = JSON.parse(readFileSync(input.path, "utf8"));
    const expected = { pid: process.pid, nonce: input.nonce, processIdentity: input.identity };
    if (JSON.stringify(value) !== JSON.stringify(expected) || !samePathIdentity(input.path, stats, true)) return;
    unlinkSync(input.path); fsyncDirectory(input.directory);
  } catch { /* retain an owner whose exact identity cannot be proven */ }
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  return Object.keys(value).sort().join(",") === [...expected].sort().join(",");
}
function parseResult(bytes: Buffer, token: string): WorkerResult {
  if (bytes.length < 2 || bytes.length > MAX_RESULT_BYTES || bytes.at(-1) !== 10
      || bytes.subarray(0, -1).includes(10) || !bytes.subarray(0, -1).toString("utf8").match(/^[\x20-\x7e]+$/)) {
    throw new Error("ownership worker result framing is invalid");
  }
  const text = bytes.toString("utf8");
  const value: unknown = JSON.parse(text.slice(0, -1));
  if (!value || typeof value !== "object" || Array.isArray(value)
      || !exactKeys(value, ["schemaVersion", "token", "outcome", "owner", "reason"])) throw new Error("ownership worker result schema is invalid");
  const result = value as Partial<WorkerResult>;
  if (result.schemaVersion !== 1 || result.token !== token || !["acquired", "busy", "denied"].includes(String(result.outcome))) {
    throw new Error("ownership worker result authentication failed");
  }
  if (result.outcome === "acquired") {
    const owner = result.owner;
    if (result.reason !== null || !owner || typeof owner !== "object" || Array.isArray(owner)
        || !exactKeys(owner, ["pid", "nonce", "processIdentity", "device", "inode"])
        || owner.pid !== process.pid || typeof owner.nonce !== "string" || typeof owner.device !== "string" || typeof owner.inode !== "string"
        || !owner.processIdentity || !exactKeys(owner.processIdentity, ["platform", "bootId", "startTimeTicks"])) {
      throw new Error("ownership worker acquired result is invalid");
    }
  } else if (result.owner !== null || !["live-owner", "legacy-owner-active", "malformed-recent", "nfs-unqualified"].includes(String(result.reason))) {
    throw new Error("ownership worker non-owner result is invalid");
  }
  if (`${JSON.stringify(value)}\n` !== text) throw new Error("ownership worker result is not canonical");
  return result as WorkerResult;
}

export function acquireOwnershipSync(input: {
  directory: string; kind: "import" | "pdf"; releaseId: string; qualification?: "local" | "nfs-qualified-v1";
}): OwnershipHandle {
  if (process.platform !== "linux" || !SAFE_RELEASE.test(input.releaseId)) throw new Error("unsupported ownership worker input");
  const directory = resolve(input.directory);
  const directoryStats = lstatSync(directory, { bigint: true });
  if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory() || realpathSync(directory) !== directory) throw new Error("transaction directory must be canonical");
  const identity = processIdentity(process.pid);
  const token = randomUUID(); const nonce = randomUUID();
  const attemptedOwnerPath = join(directory, ownerName(input.kind, input.releaseId));
  const initializedMutex = initializeMutex(directory);
  const mutexPath = initializedMutex.path;
  const mutex = initializedMutex.descriptor;
  const mutexStats = initializedMutex.stats;
  let directoryFd: number | null = null;
  let resultPath: string | null = null;
  let resultFd: number | null = null;
  let workerReturned = false;
  let published: OwnershipOwner | null = null;
  try {
    directoryFd = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    resultPath = join(directory, `.ownership-worker-result-${process.pid}-${randomUUID()}.tmp`);
    resultFd = openSync(resultPath, constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_RDWR, 0o600);
    const resultStats = fstatSync(resultFd, { bigint: true });
    const openedDirectory = fstatSync(directoryFd, { bigint: true });
    const child = spawnSync(FLOCK, ["-x", "-n", "-E", "99", "-F", "--", "/proc/self/fd/3", process.execPath, WORKER,
      "--protocol", "1", "--token", token, "--kind", input.kind, "--release", input.releaseId,
      "--parent-pid", String(process.pid), "--parent-boot-id", identity.bootId, "--parent-start-ticks", identity.startTimeTicks,
      "--owner-nonce", nonce, "--mutex-device", String(mutexStats.dev), "--mutex-inode", String(mutexStats.ino),
      "--directory-device", String(openedDirectory.dev), "--directory-inode", String(openedDirectory.ino),
      "--result-device", String(resultStats.dev), "--result-inode", String(resultStats.ino),
      "--qualification", input.qualification ?? "local"], {
      shell: false, stdio: ["ignore", "ignore", "pipe", mutex, resultFd, directoryFd], encoding: "utf8",
      timeout: 15_000, killSignal: "SIGKILL", maxBuffer: 16 * 1024,
    });
    workerReturned = true;
    const finalResultStats = fstatSync(resultFd, { bigint: true });
    if (child.error || child.signal || child.status === null) throw new Error(`ownership worker supervision failed: ${child.error?.message ?? child.signal ?? "unknown"}`);
    if (child.status === 99) {
      if (finalResultStats.size !== 0n) throw new Error("flock contention produced an invalid result");
      return { outcome: "busy", reason: "flock-contention", owner: null };
    }
    if (child.status !== 0) throw new Error(`ownership worker failed with exit ${child.status}: ${String(child.stderr).slice(0, 1024)}`);
    if (!finalResultStats.isFile() || finalResultStats.dev !== resultStats.dev || finalResultStats.ino !== resultStats.ino
        || finalResultStats.size < 1n || finalResultStats.size > BigInt(MAX_RESULT_BYTES)
        || !samePathIdentity(resultPath, resultStats, true)) throw new Error("ownership worker result inode is invalid");
    const bytes = Buffer.alloc(Number(finalResultStats.size));
    if (readSync(resultFd, bytes, 0, bytes.length, 0) !== bytes.length) throw new Error("short ownership worker result read");
    const result = parseResult(bytes, token);
    if (result.outcome !== "acquired") return { outcome: result.outcome, reason: result.reason!, owner: null };
    const owner = result.owner;
    if (!owner) throw new Error("ownership worker acquired result has no owner");
    if (owner.nonce !== nonce || JSON.stringify(owner.processIdentity) !== JSON.stringify(identity)
        || !samePathIdentity(mutexPath, mutexStats, true) || !samePathIdentity(directory, openedDirectory, false)
        || JSON.stringify(processIdentity(process.pid)) !== JSON.stringify(identity)) throw new Error("ownership worker parent identity changed");
    published = owner;
    const path = attemptedOwnerPath;
    const ownerStats = lstatSync(path, { bigint: true });
    if (ownerStats.size < 1n || ownerStats.size > BigInt(MAX_RESULT_BYTES)) {
      throw new Error("ownership worker published owner is not bounded");
    }
    const ownerValue = JSON.parse(readFileSync(path, "utf8"));
    if (!samePathIdentity(path, { dev: BigInt(owner.device), ino: BigInt(owner.inode) }, true)
        || ownerStats.dev !== BigInt(owner.device) || ownerStats.ino !== BigInt(owner.inode)
        || JSON.stringify(ownerValue) !== JSON.stringify({ pid: process.pid, nonce, processIdentity: identity })) {
      throw new Error("ownership worker published owner mismatch");
    }
    return { outcome: "acquired", reason: null, owner, directory, ownerPath: path };
  } catch (error) {
    if (workerReturned) cleanupAttemptOwner({ directory, path: attemptedOwnerPath, nonce, identity, published });
    throw error;
  } finally {
    if (directoryFd !== null) closeSync(directoryFd);
    closeSync(mutex);
    if (resultFd !== null) {
      let retained: ReturnType<typeof fstatSync> | null = null;
      try { retained = fstatSync(resultFd, { bigint: true }); } catch { /* retain an unverified result pathname */ }
      closeSync(resultFd);
      if (resultPath !== null && retained && samePathIdentity(resultPath, retained, true)) {
        try { unlinkSync(resultPath); fsyncDirectory(directory); } catch { /* leave a verified orphan for later cleanup */ }
      }
    }
  }
}

export function releaseOwnership(handle: OwnershipHandle): void {
  if (handle.outcome !== "acquired") return;
  try {
    const stats = lstatSync(handle.ownerPath, { bigint: true });
    const value = JSON.parse(readFileSync(handle.ownerPath, "utf8"));
    if (!stats.isSymbolicLink() && stats.isFile() && String(stats.dev) === handle.owner.device && String(stats.ino) === handle.owner.inode
        && JSON.stringify(value) === JSON.stringify({ pid: handle.owner.pid, nonce: handle.owner.nonce, processIdentity: handle.owner.processIdentity })) {
      unlinkSync(handle.ownerPath); fsyncDirectory(handle.directory);
    }
  } catch { /* retain an owner whose exact identity cannot be proven */ }
}
