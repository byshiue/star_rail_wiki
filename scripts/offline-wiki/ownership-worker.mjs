import { randomUUID } from "node:crypto";
import {
  closeSync, constants, fstatSync, fsyncSync, linkSync, lstatSync, openSync,
  readFileSync, readdirSync, readSync, renameSync, statfsSync, unlinkSync, writeSync,
} from "node:fs";

const EXIT_USAGE = 64;
const EXIT_INVARIANT = 65;
const EXIT_FAILURE = 70;
const EXIT_RESULT = 74;
const EXIT_PARENT_GONE = 75;
const MAX_RESULT_BYTES = 4096;
const MUTEX_MARKER = "star-rail-ownership-mutex-v1\n";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SAFE_RELEASE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,126}[A-Za-z0-9])?$/;
const DECIMAL = /^(?:0|[1-9][0-9]{0,39})$/;
const POSITIVE_DECIMAL = /^[1-9][0-9]{0,39}$/;
const LEGACY_GRACE_MS = 30_000;
const NFS_MAGIC = 0x6969n;
const FLAGS = [
  "protocol", "token", "kind", "release", "parent-pid", "parent-boot-id",
  "parent-start-ticks", "owner-nonce", "mutex-device", "mutex-inode",
  "directory-device", "directory-inode", "result-device", "result-inode", "qualification",
];

function fail(message, code) {
  if (message) process.stderr.write(`${String(message).slice(0, 1024)}\n`);
  process.exit(code === 99 ? EXIT_FAILURE : code);
}

function parseArguments(argv) {
  if (argv.join(" ").length > 4096 || argv.length !== FLAGS.length * 2) fail("invalid ownership worker arguments", EXIT_USAGE);
  const values = Object.create(null);
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith("--") || value === undefined || value.length > 256) fail("invalid ownership worker arguments", EXIT_USAGE);
    const key = flag.slice(2);
    if (!FLAGS.includes(key) || Object.hasOwn(values, key)) fail("invalid ownership worker arguments", EXIT_USAGE);
    values[key] = value;
  }
  if (FLAGS.some((key) => !Object.hasOwn(values, key))) fail("missing ownership worker argument", EXIT_USAGE);
  const normalized = Object.fromEntries(Object.entries(values).map(([key, value]) => [
    key.replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase()), value,
  ]));
  if (normalized.protocol !== "1" || !UUID.test(normalized.token) || !UUID.test(normalized.ownerNonce)
      || !["import", "pdf"].includes(normalized.kind) || !SAFE_RELEASE.test(normalized.release)
      || !POSITIVE_DECIMAL.test(normalized.parentPid)
      || !UUID.test(normalized.parentBootId) || !POSITIVE_DECIMAL.test(normalized.parentStartTicks)
      || !["local", "nfs-qualified-v1"].includes(normalized.qualification)
      || ["mutexDevice", "mutexInode", "directoryDevice", "directoryInode", "resultDevice", "resultInode"]
        .some((key) => !DECIMAL.test(normalized[key]))) fail("malformed ownership worker argument", EXIT_USAGE);
  return normalized;
}

function sameIdentity(stats, device, inode) {
  return stats.dev === BigInt(device) && stats.ino === BigInt(inode);
}

function processIdentity(pid) {
  const bootId = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  const closeParen = stat.lastIndexOf(")");
  if (closeParen < 0) throw new Error("parent stat is malformed");
  const startTimeTicks = stat.slice(closeParen + 2).split(" ")[19];
  if (!POSITIVE_DECIMAL.test(startTimeTicks)) throw new Error("parent start time is malformed");
  return { platform: "linux", bootId, startTimeTicks };
}

function assertParent(args) {
  if (Number(args.parentPid) !== process.ppid) fail("parent pid mismatch", EXIT_PARENT_GONE);
  let current;
  try { current = processIdentity(args.parentPid); }
  catch { fail("parent process disappeared", EXIT_PARENT_GONE); }
  if (current.bootId !== args.parentBootId || current.startTimeTicks !== args.parentStartTicks) {
    fail("parent process identity changed", EXIT_PARENT_GONE);
  }
}

function assertDescriptors(args) {
  try {
    const mutex = fstatSync(3, { bigint: true });
    const result = fstatSync(4, { bigint: true });
    const directory = fstatSync(5, { bigint: true });
    if (!mutex.isFile() || !sameIdentity(mutex, args.mutexDevice, args.mutexInode)
        || readFileSync("/proc/self/fd/3", "utf8") !== MUTEX_MARKER) throw new Error("mutex descriptor invariant failed");
    if (!result.isFile() || result.size !== 0n || !sameIdentity(result, args.resultDevice, args.resultInode)) {
      throw new Error("result descriptor invariant failed");
    }
    if (!directory.isDirectory() || !sameIdentity(directory, args.directoryDevice, args.directoryInode)) {
      throw new Error("directory descriptor invariant failed");
    }
  } catch (error) {
    fail(error instanceof Error ? error.message : "descriptor invariant failed", EXIT_INVARIANT);
  }
}

function fsyncDirectory() { fsyncSync(5); }
function ownerBasename(args) {
  return args.kind === "import" ? ".normalized-transaction.lock" : `.${args.release}.build-transaction.lock`;
}
function ownerPath(name) { return `/proc/self/fd/5/${name}`; }

class MalformedOwnerFile extends Error {
  constructor(stats) { super("malformed owner file"); this.stats = stats; }
}

function readOwner(path) {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stats = fstatSync(descriptor, { bigint: true });
    if (!stats.isFile()) throw new Error("owner is not a regular file");
    if (stats.size < 1n || stats.size > BigInt(MAX_RESULT_BYTES)) throw new MalformedOwnerFile(stats);
    const bytes = Buffer.alloc(Number(stats.size));
    if (readSync(descriptor, bytes, 0, bytes.length, 0) !== bytes.length) throw new Error("short owner read");
    const current = lstatSync(path, { bigint: true });
    if (current.isSymbolicLink() || !current.isFile() || current.dev !== stats.dev || current.ino !== stats.ino) {
      throw new Error("owner pathname identity changed during read");
    }
    try { return { stats, value: JSON.parse(bytes.toString("utf8")) }; }
    catch { throw new MalformedOwnerFile(stats); }
  } finally {
    closeSync(descriptor);
  }
}

function parseOwner(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("malformed owner");
  const keys = Object.keys(value).sort().join(",");
  if (keys !== "nonce,pid" && keys !== "nonce,pid,processIdentity") throw new Error("malformed owner");
  if (!Number.isInteger(value.pid) || value.pid <= 0 || typeof value.nonce !== "string" || value.nonce.length < 1 || value.nonce.length > 256) throw new Error("malformed owner");
  if (value.processIdentity !== undefined && (!value.processIdentity || Object.keys(value.processIdentity).sort().join(",") !== "bootId,platform,startTimeTicks"
      || value.processIdentity.platform !== "linux" || !UUID.test(value.processIdentity.bootId) || !POSITIVE_DECIMAL.test(value.processIdentity.startTimeTicks))) throw new Error("malformed owner");
  return value;
}

function ownerIsLive(value) {
  try { process.kill(value.pid, 0); }
  catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ESRCH") return false;
    if (error && typeof error === "object" && "code" in error && error.code === "EPERM") return true;
    throw error;
  }
  if (!value.processIdentity) return true;
  try {
    const current = processIdentity(value.pid);
    return current.bootId === value.processIdentity.bootId && current.startTimeTicks === value.processIdentity.startTimeTicks;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && ["ENOENT", "ESRCH"].includes(String(error.code))) return false;
    return true;
  }
}

function observeArtifact(path) {
  let observed;
  try {
    observed = readOwner(path);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return { state: "absent" };
    if (error instanceof MalformedOwnerFile) return { state: "malformed", stats: error.stats };
    throw error;
  }
  try { return { state: "valid", ...observed, value: parseOwner(observed.value) }; }
  catch { return { state: "malformed", stats: observed.stats }; }
}

function boundary(args) {
  assertDescriptors(args);
  const mutex = lstatSync(ownerPath(".ownership-worker.mutex"), { bigint: true });
  const directory = fstatSync(5, { bigint: true });
  if (mutex.isSymbolicLink() || !mutex.isFile() || !sameIdentity(mutex, args.mutexDevice, args.mutexInode)
      || !directory.isDirectory() || !sameIdentity(directory, args.directoryDevice, args.directoryInode)) fail("pathname identity changed", EXIT_INVARIANT);
  assertParent(args);
}

function needsStaleMutation(artifact) {
  return artifact.state === "valid" ? !ownerIsLive(artifact.value) : artifact.state === "malformed";
}

function isRecentMalformed(artifact) {
  return artifact.state === "malformed" && Date.now() - Number(artifact.stats.mtimeMs) < LEGACY_GRACE_MS;
}

function isolateArtifact(args, basename, artifact) {
  boundary(args);
  const canonical = ownerPath(basename);
  const tombstone = ownerPath(`${basename}.stale-${randomUUID()}`);
  const current = lstatSync(canonical, { bigint: true });
  if (current.dev !== artifact.stats.dev || current.ino !== artifact.stats.ino) throw new Error("ownership artifact changed before isolation");
  renameSync(canonical, tombstone); fsyncDirectory();
  const isolated = lstatSync(tombstone, { bigint: true });
  if (isolated.dev !== artifact.stats.dev || isolated.ino !== artifact.stats.ino) throw new Error("ownership artifact isolation mismatch");
  return { path: tombstone, stats: isolated };
}

function removeIsolated(args, isolated) {
  boundary(args);
  const current = lstatSync(isolated.path, { bigint: true });
  if (current.dev !== isolated.stats.dev || current.ino !== isolated.stats.ino) throw new Error("isolated artifact changed");
  unlinkSync(isolated.path); fsyncDirectory();
}

function escaped(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function cleanupArtifacts(args, basename, mutate = true) {
  const family = "(?:" + escaped(basename) + "|" + escaped(basename + "-reclaim")
    + "|" + escaped(basename + "-reclaim-claim") + ")";
  const pattern = new RegExp("^" + family + "(?:\\.candidate-[0-9a-f-]{36}\\.tmp|\\.stale-[0-9a-f-]{36})$");
  let cleanupNeeded = false;
  for (const name of readdirSync("/proc/self/fd/5")) {
    if (!pattern.test(name)) continue;
    const path = ownerPath(name);
    const artifact = observeArtifact(path);
    if (artifact.state !== "valid" || ownerIsLive(artifact.value)) continue;
    cleanupNeeded = true;
    if (!mutate) continue;
    boundary(args);
    const current = lstatSync(path, { bigint: true });
    if (current.dev !== artifact.stats.dev || current.ino !== artifact.stats.ino) throw new Error("cleanup artifact changed");
    unlinkSync(path); fsyncDirectory();
  }
  return cleanupNeeded;
}

function writeResult(args, outcome, owner, reason) {
  try {
    const value = { schemaVersion: 1, token: args.token, outcome, owner, reason };
    const bytes = Buffer.from(`${JSON.stringify(value)}\n`, "utf8");
    if (bytes.length > MAX_RESULT_BYTES || fstatSync(4, { bigint: true }).size !== 0n) fail("result is not empty or bounded", EXIT_RESULT);
    const written = writeSync(4, bytes, 0, bytes.length, 0);
    if (written !== bytes.length) fail("short result write", EXIT_RESULT);
    fsyncSync(4);
  } catch (error) {
    fail(error instanceof Error ? error.message : "result commit failed", EXIT_RESULT);
  }
}

function publishFreshOwner(args) {
  const basename = ownerBasename(args);
  const canonical = ownerPath(basename);
  const claimName = `${basename}-reclaim-claim`;
  const guardName = `${basename}-reclaim`;
  const claim = observeArtifact(ownerPath(claimName));
  const guard = observeArtifact(ownerPath(guardName));
  const existing = observeArtifact(canonical);
  for (const artifact of [claim, guard]) {
    if (artifact.state === "valid" && ownerIsLive(artifact.value)) {
      writeResult(args, "busy", null, "legacy-owner-active"); return;
    }
    if (isRecentMalformed(artifact)) { writeResult(args, "denied", null, "malformed-recent"); return; }
  }
  if (existing.state === "valid" && ownerIsLive(existing.value)) {
    writeResult(args, "busy", null, existing.value.processIdentity ? "live-owner" : "legacy-owner-active"); return;
  }
  if (isRecentMalformed(existing)) { writeResult(args, "denied", null, "malformed-recent"); return; }
  const stale = [claim, guard, existing].some(needsStaleMutation) || cleanupArtifacts(args, basename, false);
  if (stale && statfsSync("/proc/self/fd/5", { bigint: true }).type === NFS_MAGIC && args.qualification !== "nfs-qualified-v1") {
    writeResult(args, "denied", null, "nfs-unqualified"); return;
  }
  const claimTombstone = needsStaleMutation(claim) ? isolateArtifact(args, claimName, claim) : null;
  if (claimTombstone) removeIsolated(args, claimTombstone);
  const guardTombstone = needsStaleMutation(guard) ? isolateArtifact(args, guardName, guard) : null;
  if (guardTombstone) removeIsolated(args, guardTombstone);
  cleanupArtifacts(args, basename);
  const ownerTombstone = needsStaleMutation(existing) ? isolateArtifact(args, basename, existing) : null;

  const identity = { platform: "linux", bootId: args.parentBootId, startTimeTicks: args.parentStartTicks };
  const ownerValue = { pid: Number(args.parentPid), nonce: args.ownerNonce, processIdentity: identity };
  const candidate = ownerPath(`${basename}.candidate-${randomUUID()}.tmp`);
  boundary(args);
  const descriptor = openSync(candidate, constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW | constants.O_WRONLY, 0o600);
  try {
    const bytes = Buffer.from(JSON.stringify(ownerValue), "utf8");
    if (writeSync(descriptor, bytes, 0, bytes.length, 0) !== bytes.length) throw new Error("short owner write");
    fsyncSync(descriptor);
  } finally { closeSync(descriptor); }
  let published = false;
  try {
    boundary(args);
    linkSync(candidate, canonical);
    published = true;
    fsyncDirectory();
    const observed = readOwner(canonical);
    if (JSON.stringify(observed.value) !== JSON.stringify(ownerValue)) throw new Error("published owner value mismatch");
    boundary(args);
    unlinkSync(candidate);
    fsyncDirectory();
    if (ownerTombstone) removeIsolated(args, ownerTombstone);
    writeResult(args, "acquired", {
      ...ownerValue, device: String(observed.stats.dev), inode: String(observed.stats.ino),
    }, null);
  } catch (error) {
    if (!published) {
      try { unlinkSync(candidate); fsyncDirectory(); } catch { /* retain ambiguous artifact */ }
    }
    throw error;
  }
}

const args = parseArguments(process.argv.slice(2));
try {
  assertDescriptors(args);
  assertParent(args);
  publishFreshOwner(args);
} catch (error) {
  fail(error instanceof Error ? error.message : "ownership worker failed", EXIT_FAILURE);
}
