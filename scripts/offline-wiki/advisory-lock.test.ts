import { closeSync, constants, mkdtempSync, openSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { acquireOwnershipSync, releaseOwnership } from "./advisory-lock";

describe("one-shot flock ownership worker", () => {
  it("executes behind real flock with FD 3/4/5 and publishes the parent-owned owner", () => {
    const directory = mkdtempSync(join(tmpdir(), "ownership-worker-red-"));
    const mutexPath = join(directory, ".ownership-worker.mutex");
    const resultPath = join(directory, ".ownership-worker-result-red.tmp");
    writeFileSync(mutexPath, "star-rail-ownership-mutex-v1\n", { mode: 0o600 });
    writeFileSync(resultPath, "", { flag: "wx", mode: 0o600 });
    const mutex = openSync(mutexPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const result = openSync(resultPath, constants.O_RDWR | constants.O_NOFOLLOW);
    const directoryFd = openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    const mutexStats = statSync(mutexPath, { bigint: true });
    const resultStats = statSync(resultPath, { bigint: true });
    const directoryStats = statSync(directory, { bigint: true });
    const bootId = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
    const stat = readFileSync(`/proc/${process.pid}/stat`, "utf8");
    const startTimeTicks = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
    const token = "00000000-0000-4000-8000-000000000001";
    const ownerNonce = "00000000-0000-4000-8000-000000000002";
    try {
      const child = spawnSync("/usr/bin/flock", [
        "-x", "-n", "-E", "99", "-F", "--", "/proc/self/fd/3",
        process.execPath, resolve("scripts/offline-wiki/ownership-worker.mjs"),
        "--protocol", "1", "--token", token, "--kind", "import", "--release", "4.4-fixture",
        "--parent-pid", String(process.pid), "--parent-boot-id", bootId, "--parent-start-ticks", startTimeTicks,
        "--owner-nonce", ownerNonce, "--mutex-device", String(mutexStats.dev), "--mutex-inode", String(mutexStats.ino),
        "--directory-device", String(directoryStats.dev), "--directory-inode", String(directoryStats.ino),
        "--result-device", String(resultStats.dev), "--result-inode", String(resultStats.ino), "--qualification", "local",
      ], { shell: false, stdio: ["ignore", "ignore", "pipe", mutex, result, directoryFd], encoding: "utf8" });
      expect(child.status, child.stderr).toBe(0);
    } finally {
      closeSync(directoryFd); closeSync(result); closeSync(mutex);
    }
    const resultValue = JSON.parse(readFileSync(resultPath, "utf8"));
    expect(resultValue).toMatchObject({ schemaVersion: 1, token, outcome: "acquired", reason: null,
      owner: { pid: process.pid, nonce: ownerNonce, processIdentity: { platform: "linux", bootId, startTimeTicks } } });
    expect(JSON.parse(readFileSync(join(directory, ".normalized-transaction.lock"), "utf8"))).toMatchObject({
      pid: process.pid, nonce: ownerNonce,
    });
  });

  it("runs the authenticated worker through the synchronous parent API and releases only its exact owner", () => {
    const directory = mkdtempSync(join(tmpdir(), "ownership-runner-red-"));
    const script = join(directory, "runner.mjs");
    const moduleUrl = pathToFileURL(resolve("scripts/offline-wiki/advisory-lock.ts")).href;
    writeFileSync(script, `import { acquireOwnershipSync, releaseOwnership } from ${JSON.stringify(moduleUrl)};\n`
      + `const handle = acquireOwnershipSync({ directory: ${JSON.stringify(directory)}, kind: "import", releaseId: "4.4-fixture" });\n`
      + `if (handle.outcome !== "acquired") throw new Error(JSON.stringify(handle));\n`
      + `releaseOwnership(handle);\n`);
    const child = spawnSync(process.execPath, ["--import", "tsx", script], { encoding: "utf8" });
    expect(child.status, child.stderr).toBe(0);
    expect(() => readFileSync(join(directory, ".normalized-transaction.lock"))).toThrow();
    expect(() => readFileSync(join(directory, ".ownership-worker.mutex"))).not.toThrow();
    rmSync(directory, { recursive: true, force: true });
  });

  it("recovers a dead legacy owner plus guard and claim only inside the worker flock", () => {
    const directory = mkdtempSync(join(tmpdir(), "ownership-worker-stale-red-"));
    const ownerPath = join(directory, ".normalized-transaction.lock");
    const guardPath = `${ownerPath}-reclaim`;
    const claimPath = `${guardPath}-claim`;
    const dead = JSON.stringify({ pid: 2_147_483_647, nonce: "legacy-dead" });
    writeFileSync(ownerPath, dead); writeFileSync(guardPath, dead); writeFileSync(claimPath, dead);
    const handle = acquireOwnershipSync({ directory, kind: "import", releaseId: "4.4-fixture" });
    expect(handle.outcome).toBe("acquired");
    expect(() => readFileSync(guardPath)).toThrow();
    expect(() => readFileSync(claimPath)).toThrow();
    if (handle.outcome === "acquired") {
      expect(JSON.parse(readFileSync(ownerPath, "utf8")).processIdentity).toEqual(handle.owner.processIdentity);
      releaseOwnership(handle);
    }
  });

  it("rejects zero parent start ticks as usage failure and never returns flock's reserved 99", () => {
    const child = spawnSync(process.execPath, [resolve("scripts/offline-wiki/ownership-worker.mjs"),
      "--protocol", "1", "--token", "00000000-0000-4000-8000-000000000001",
      "--kind", "import", "--release", "4.4-fixture", "--parent-pid", String(process.pid),
      "--parent-boot-id", "00000000-0000-4000-8000-000000000002", "--parent-start-ticks", "0",
      "--owner-nonce", "00000000-0000-4000-8000-000000000003", "--mutex-device", "1",
      "--mutex-inode", "1", "--directory-device", "1", "--directory-inode", "1",
      "--result-device", "1", "--result-inode", "1", "--qualification", "local",
    ], { encoding: "utf8" });
    expect(child.status).toBe(64);
    expect(child.status).not.toBe(99);
  });

  it("classifies descriptor inspection exceptions as invariant exit 65", () => {
    const directory = mkdtempSync(join(tmpdir(), "ownership-fd-invariant-"));
    const preload = join(directory, "fail-fstat.mjs");
    writeFileSync(preload, [
      'import fs from "node:fs";', 'import { syncBuiltinESMExports } from "node:module";',
      'const original = fs.fstatSync;',
      'fs.fstatSync = function(fd, ...args) { if (fd === 3) throw Object.assign(new Error("fstat failed"), { code: "EIO" }); return original.call(this, fd, ...args); };',
      'syncBuiltinESMExports();',
    ].join("\n"));
    const bootId = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
    const stat = readFileSync(`/proc/${process.pid}/stat`, "utf8");
    const startTimeTicks = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
    const child = spawnSync(process.execPath, [resolve("scripts/offline-wiki/ownership-worker.mjs"),
      "--protocol", "1", "--token", "00000000-0000-4000-8000-000000000001",
      "--kind", "import", "--release", "4.4-fixture", "--parent-pid", String(process.pid),
      "--parent-boot-id", bootId, "--parent-start-ticks", startTimeTicks,
      "--owner-nonce", "00000000-0000-4000-8000-000000000003", "--mutex-device", "1",
      "--mutex-inode", "1", "--directory-device", "1", "--directory-inode", "1",
      "--result-device", "1", "--result-inode", "1", "--qualification", "local",
    ], { encoding: "utf8", env: { ...process.env, NODE_OPTIONS: `--import=${pathToFileURL(preload).href}` } });
    expect(child.status).toBe(65);
  });

  it("removes only its exact parent-owned owner when result commit fails after publication", () => {
    const directory = mkdtempSync(join(tmpdir(), "ownership-result-failure-red-"));
    const preload = join(directory, "fail-result-write.mjs");
    writeFileSync(preload, [
      'import fs from "node:fs";',
      'import { syncBuiltinESMExports } from "node:module";',
      'const original = fs.writeSync;',
      'fs.writeSync = function(fd, ...args) { if (fd === 4) throw new Error("injected result failure"); return original.call(this, fd, ...args); };',
      'syncBuiltinESMExports();',
    ].join("\n"));
    const previous = process.env.NODE_OPTIONS;
    process.env.NODE_OPTIONS = [previous, `--import=${pathToFileURL(preload).href}`].filter(Boolean).join(" ");
    try {
      expect(() => acquireOwnershipSync({ directory, kind: "import", releaseId: "4.4-fixture" }))
        .toThrow(/exit 74/i);
    } finally {
      if (previous === undefined) delete process.env.NODE_OPTIONS;
      else process.env.NODE_OPTIONS = previous;
    }
    expect(() => readFileSync(join(directory, ".normalized-transaction.lock"))).toThrow();
    const next = acquireOwnershipSync({ directory, kind: "import", releaseId: "4.4-fixture" });
    expect(next.outcome).toBe("acquired");
    releaseOwnership(next);
  });

  it("returns only flock contention while another real direct child holds the permanent inode", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ownership-contention-"));
    const initialized = acquireOwnershipSync({ directory, kind: "import", releaseId: "4.4-fixture" });
    releaseOwnership(initialized);
    const mutex = openSync(join(directory, ".ownership-worker.mutex"), constants.O_RDONLY | constants.O_NOFOLLOW);
    const holder = spawn("/usr/bin/flock", ["-x", "-n", "-E", "99", "-F", "--", "/proc/self/fd/3",
      process.execPath, "-e", 'process.stdout.write("HELD\\n");setInterval(() => {}, 1000)'],
    { shell: false, stdio: ["ignore", "pipe", "pipe", mutex] });
    try {
      await once(holder.stdout!, "data");
      const contender = acquireOwnershipSync({ directory, kind: "import", releaseId: "4.4-fixture" });
      expect(contender).toEqual({ outcome: "busy", reason: "flock-contention", owner: null });
      expect(() => readFileSync(join(directory, ".normalized-transaction.lock"))).toThrow();
    } finally {
      holder.kill("SIGKILL"); await once(holder, "close"); closeSync(mutex);
    }
  });

  it("fails closed without stale mutation on an unqualified NFS worker observation", () => {
    const directory = mkdtempSync(join(tmpdir(), "ownership-nfs-gate-"));
    const ownerPath = join(directory, ".normalized-transaction.lock");
    writeFileSync(ownerPath, JSON.stringify({ pid: 2_147_483_647, nonce: "dead-nfs-owner" }));
    const preload = join(directory, "report-nfs.mjs");
    writeFileSync(preload, [
      'import fs from "node:fs";', 'import { syncBuiltinESMExports } from "node:module";',
      'const original = fs.statfsSync;',
      'fs.statfsSync = function(path, options) { const value = original.call(this, path, options); return String(path) === "/proc/self/fd/5" ? { ...value, type: 0x6969n } : value; };',
      'syncBuiltinESMExports();',
    ].join("\n"));
    const previous = process.env.NODE_OPTIONS;
    process.env.NODE_OPTIONS = [previous, `--import=${pathToFileURL(preload).href}`].filter(Boolean).join(" ");
    let result;
    try { result = acquireOwnershipSync({ directory, kind: "import", releaseId: "4.4-fixture" }); }
    finally { if (previous === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = previous; }
    expect(result).toEqual({ outcome: "denied", reason: "nfs-unqualified", owner: null });
    expect(readFileSync(ownerPath, "utf8")).toContain("dead-nfs-owner");
  });

  it("does not clean an orphan owner candidate on unqualified NFS", () => {
    const directory = mkdtempSync(join(tmpdir(), "ownership-nfs-candidate-gate-"));
    const candidate = join(directory, ".normalized-transaction.lock.candidate-00000000-0000-4000-8000-000000000004.tmp");
    writeFileSync(candidate, JSON.stringify({ pid: 2_147_483_647, nonce: "dead-nfs-candidate" }));
    const preload = join(directory, "report-nfs.mjs");
    writeFileSync(preload, [
      'import fs from "node:fs";', 'import { syncBuiltinESMExports } from "node:module";',
      'const original = fs.statfsSync;',
      'fs.statfsSync = function(path, options) { const value = original.call(this, path, options); return String(path) === "/proc/self/fd/5" ? { ...value, type: 0x6969n } : value; };',
      'syncBuiltinESMExports();',
    ].join("\n"));
    const previous = process.env.NODE_OPTIONS;
    process.env.NODE_OPTIONS = [previous, `--import=${pathToFileURL(preload).href}`].filter(Boolean).join(" ");
    let result;
    try { result = acquireOwnershipSync({ directory, kind: "import", releaseId: "4.4-fixture" }); }
    finally { if (previous === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = previous; }
    expect(result).toEqual({ outcome: "denied", reason: "nfs-unqualified", owner: null });
    expect(readFileSync(candidate, "utf8")).toContain("dead-nfs-candidate");
  });

  it("rejects a symlinked permanent mutex without touching its target", () => {
    const directory = mkdtempSync(join(tmpdir(), "ownership-mutex-symlink-"));
    const target = join(directory, "target"); writeFileSync(target, "keep");
    symlinkSync(target, join(directory, ".ownership-worker.mutex"));
    expect(() => acquireOwnershipSync({ directory, kind: "import", releaseId: "4.4-fixture" })).toThrow(/mutex.*unsafe/i);
    expect(readFileSync(target, "utf8")).toBe("keep");
  });

  it("validates the permanent mutex marker through its opened descriptor", () => {
    const directory = mkdtempSync(join(tmpdir(), "ownership-mutex-fd-read-"));
    const mutexPath = join(directory, ".ownership-worker.mutex");
    writeFileSync(mutexPath, "star-rail-ownership-mutex-v1\n", { mode: 0o600 });
    const preload = join(directory, "reject-mutex-path-read.mjs");
    writeFileSync(preload, [
      'import fs from "node:fs";', 'import { syncBuiltinESMExports } from "node:module";',
      'const original = fs.readFileSync;',
      `fs.readFileSync = function(path, ...args) { if (String(path) === ${JSON.stringify(mutexPath)}) throw new Error("mutex pathname was read"); return original.call(this, path, ...args); };`,
      'syncBuiltinESMExports();',
    ].join("\n"));
    const runner = join(directory, "runner.mjs");
    const moduleUrl = pathToFileURL(resolve("scripts/offline-wiki/advisory-lock.ts")).href;
    writeFileSync(runner, `import { acquireOwnershipSync, releaseOwnership } from ${JSON.stringify(moduleUrl)};\n`
      + `const result=acquireOwnershipSync({directory:${JSON.stringify(directory)},kind:"import",releaseId:"4.4-fixture"});\n`
      + `if(result.outcome!=="acquired") throw new Error(JSON.stringify(result)); releaseOwnership(result);\n`);
    const previous = process.env.NODE_OPTIONS;
    const nodeOptions = [previous, `--import=${pathToFileURL(preload).href}`].filter(Boolean).join(" ");
    const child = spawnSync(process.execPath, ["--import", "tsx", runner], {
      encoding: "utf8", env: { ...process.env, NODE_OPTIONS: nodeOptions },
    });
    expect(child.status, child.stderr).toBe(0);
  });

  it("cleans setup descriptors and the result pathname when procfs identity setup fails", () => {
    const directory = mkdtempSync(join(tmpdir(), "ownership-setup-cleanup-"));
    const preload = join(directory, "deny-parent-identity.mjs");
    writeFileSync(preload, [
      'import fs from "node:fs";', 'import { syncBuiltinESMExports } from "node:module";',
      'const original = fs.readFileSync;',
      'fs.readFileSync = function(path, ...args) { if (String(path) === "/proc/sys/kernel/random/boot_id") throw Object.assign(new Error("identity unavailable"), { code: "EACCES" }); return original.call(this, path, ...args); };',
      'syncBuiltinESMExports();',
    ].join("\n"));
    const runner = join(directory, "runner.mjs");
    const moduleUrl = pathToFileURL(resolve("scripts/offline-wiki/advisory-lock.ts")).href;
    writeFileSync(runner, `import { readdirSync } from "node:fs";\n`
      + `import { acquireOwnershipSync } from ${JSON.stringify(moduleUrl)};\n`
      + `const before=readdirSync("/proc/self/fd").length; let failed=false;\n`
      + `try { acquireOwnershipSync({directory:${JSON.stringify(directory)},kind:"import",releaseId:"4.4-fixture"}); } catch { failed=true; }\n`
      + `const after=readdirSync("/proc/self/fd").length; const files=readdirSync(${JSON.stringify(directory)});\n`
      + `process.stdout.write(JSON.stringify({before,after,failed,files}));\n`);
    const previous = process.env.NODE_OPTIONS;
    const nodeOptions = [previous, `--import=${pathToFileURL(preload).href}`].filter(Boolean).join(" ");
    const child = spawnSync(process.execPath, ["--import", "tsx", runner], {
      encoding: "utf8", env: { ...process.env, NODE_OPTIONS: nodeOptions },
    });
    expect(child.status, child.stderr).toBe(0);
    const result = JSON.parse(child.stdout) as { before: number; after: number; failed: boolean; files: string[] };
    expect(result.failed).toBe(true);
    expect(result.after).toBeLessThanOrEqual(result.before);
    expect(result.files.filter((name) => name.startsWith(".ownership-worker-result-"))).toEqual([]);
  });

  it("reclaims the parent-owned owner after the transaction parent is SIGKILLed", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ownership-parent-death-"));
    const script = join(directory, "parent.mjs");
    const moduleUrl = pathToFileURL(resolve("scripts/offline-wiki/advisory-lock.ts")).href;
    writeFileSync(script, `import { acquireOwnershipSync } from ${JSON.stringify(moduleUrl)};\n`
      + `const result=acquireOwnershipSync({directory:${JSON.stringify(directory)},kind:"import",releaseId:"4.4-fixture"});\n`
      + `if(result.outcome!=="acquired") throw new Error(JSON.stringify(result)); process.stdout.write("READY\\n"); setInterval(()=>{},1000);\n`);
    const parent = spawn(process.execPath, ["--import", "tsx", script], { stdio: ["ignore", "pipe", "pipe"] });
    await once(parent.stdout!, "data");
    expect(JSON.parse(readFileSync(join(directory, ".normalized-transaction.lock"), "utf8")).pid).toBe(parent.pid);
    parent.kill("SIGKILL"); await once(parent, "close");
    const recovered = acquireOwnershipSync({ directory, kind: "import", releaseId: "4.4-fixture" });
    expect(recovered.outcome).toBe("acquired"); releaseOwnership(recovered);
  });

  it("rejects exit zero with a corrupt result and removes only its exact owner", () => {
    const directory = mkdtempSync(join(tmpdir(), "ownership-corrupt-result-"));
    const preload = join(directory, "corrupt-result.mjs");
    writeFileSync(preload, [
      'import fs from "node:fs";', 'import { syncBuiltinESMExports } from "node:module";',
      'const original = fs.writeSync;',
      'fs.writeSync = function(fd, value, ...args) { if (fd === 4) { const copy = Buffer.from(value); copy[0] = 88; return original.call(this, fd, copy, ...args); } return original.call(this, fd, value, ...args); };',
      'syncBuiltinESMExports();',
    ].join("\n"));
    const previous = process.env.NODE_OPTIONS;
    process.env.NODE_OPTIONS = [previous, `--import=${pathToFileURL(preload).href}`].filter(Boolean).join(" ");
    try {
      expect(() => acquireOwnershipSync({ directory, kind: "import", releaseId: "4.4-fixture" }))
        .toThrow(/framing|schema|JSON/i);
    } finally {
      if (previous === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = previous;
    }
    expect(() => readFileSync(join(directory, ".normalized-transaction.lock"))).toThrow();
    const recovered = acquireOwnershipSync({ directory, kind: "import", releaseId: "4.4-fixture" });
    expect(recovered.outcome).toBe("acquired"); releaseOwnership(recovered);
  });

  it("recovers after the worker is SIGKILLed immediately after stale-owner isolation", () => {
    const directory = mkdtempSync(join(tmpdir(), "ownership-worker-crash-"));
    const ownerPath = join(directory, ".normalized-transaction.lock");
    writeFileSync(ownerPath, JSON.stringify({ pid: 2_147_483_647, nonce: "dead-before-worker-crash" }));
    const preload = join(directory, "kill-after-isolation.mjs");
    writeFileSync(preload, [
      'import fs from "node:fs";', 'import { syncBuiltinESMExports } from "node:module";',
      'const original = fs.renameSync;',
      'fs.renameSync = function(source, destination) { const result = original.call(this, source, destination); if (String(source).endsWith("/.normalized-transaction.lock") && String(destination).includes(".stale-")) process.kill(process.pid, "SIGKILL"); return result; };',
      'syncBuiltinESMExports();',
    ].join("\n"));
    const previous = process.env.NODE_OPTIONS;
    process.env.NODE_OPTIONS = [previous, `--import=${pathToFileURL(preload).href}`].filter(Boolean).join(" ");
    try {
      expect(() => acquireOwnershipSync({ directory, kind: "import", releaseId: "4.4-fixture" }))
        .toThrow(/supervision|SIGKILL/i);
    } finally {
      if (previous === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = previous;
    }
    expect(() => readFileSync(ownerPath)).toThrow();
    const recovered = acquireOwnershipSync({ directory, kind: "import", releaseId: "4.4-fixture" });
    expect(recovered.outcome).toBe("acquired"); releaseOwnership(recovered);
  });

  it("treats a live owner as live when its procfs identity cannot be read", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ownership-proc-denied-"));
    const helper = spawn(process.execPath, ["-e", 'process.stdout.write("READY\\n");setInterval(() => {}, 1000)'],
      { stdio: ["ignore", "pipe", "pipe"] });
    try {
      await once(helper.stdout!, "data");
      const bootId = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
      const stat = readFileSync(`/proc/${helper.pid}/stat`, "utf8");
      const startTimeTicks = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
      const ownerPath = join(directory, ".normalized-transaction.lock");
      const ownerBytes = JSON.stringify({ pid: helper.pid, nonce: "live-proc-denied",
        processIdentity: { platform: "linux", bootId, startTimeTicks } });
      writeFileSync(ownerPath, ownerBytes);
      const preload = join(directory, "deny-owner-proc.mjs");
      writeFileSync(preload, [
        'import fs from "node:fs";', 'import { syncBuiltinESMExports } from "node:module";',
        'const original = fs.readFileSync;',
        `fs.readFileSync = function(path, ...args) { if (String(path) === "/proc/${helper.pid}/stat") throw Object.assign(new Error("denied"), { code: "EACCES" }); return original.call(this, path, ...args); };`,
        'syncBuiltinESMExports();',
      ].join("\n"));
      const previous = process.env.NODE_OPTIONS;
      process.env.NODE_OPTIONS = [previous, `--import=${pathToFileURL(preload).href}`].filter(Boolean).join(" ");
      let result;
      try { result = acquireOwnershipSync({ directory, kind: "import", releaseId: "4.4-fixture" }); }
      finally { if (previous === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = previous; }
      expect(result).toEqual({ outcome: "busy", reason: "live-owner", owner: null });
      expect(readFileSync(ownerPath, "utf8")).toBe(ownerBytes);
    } finally {
      helper.kill("SIGKILL"); await once(helper, "close");
    }
  });

  it.each([
    ["owner", ".normalized-transaction.lock", "EACCES"],
    ["owner", ".normalized-transaction.lock", "EIO"],
    ["guard", ".normalized-transaction.lock-reclaim", "EACCES"],
    ["guard", ".normalized-transaction.lock-reclaim", "EIO"],
  ])("fails closed when an aged live %s read fails with %s", (_label, basename, code) => {
    const directory = mkdtempSync(join(tmpdir(), "ownership-read-failure-"));
    const artifactPath = join(directory, basename);
    const bytes = JSON.stringify({ pid: process.pid, nonce: `live-${code}` });
    writeFileSync(artifactPath, bytes); utimesSync(artifactPath, new Date(0), new Date(0));
    const preload = join(directory, "fail-owner-read.mjs");
    writeFileSync(preload, [
      'import fs from "node:fs";', 'import { syncBuiltinESMExports } from "node:module";',
      'const originalOpen = fs.openSync; const originalReadFile = fs.readFileSync;',
      `const target = ${JSON.stringify(`/proc/self/fd/5/${basename}`)}; const code = ${JSON.stringify(code)};`,
      'fs.openSync = function(path, ...args) { if (String(path) === target) throw Object.assign(new Error("owner read failed"), { code }); return originalOpen.call(this, path, ...args); };',
      'fs.readFileSync = function(path, ...args) { if (String(path) === target) throw Object.assign(new Error("owner read failed"), { code }); return originalReadFile.call(this, path, ...args); };',
      'syncBuiltinESMExports();',
    ].join("\n"));
    const previous = process.env.NODE_OPTIONS;
    process.env.NODE_OPTIONS = [previous, `--import=${pathToFileURL(preload).href}`].filter(Boolean).join(" ");
    try {
      expect(() => acquireOwnershipSync({ directory, kind: "import", releaseId: "4.4-fixture" })).toThrow(/exit 70/i);
    } finally {
      if (previous === undefined) delete process.env.NODE_OPTIONS; else process.env.NODE_OPTIONS = previous;
    }
    expect(readFileSync(artifactPath, "utf8")).toBe(bytes);
    const readCanonical = () => readFileSync(join(directory, ".normalized-transaction.lock"), "utf8");
    if (basename === ".normalized-transaction.lock") expect(readCanonical).not.toThrow();
    else expect(readCanonical).toThrow();
  });
});
