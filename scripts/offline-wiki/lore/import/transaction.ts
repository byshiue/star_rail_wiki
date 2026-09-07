import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
  parseCanonicalLoreJsonl,
  serializeCanonicalLoreRecords,
  validateLocalFullTextRecords,
  type LocalFullTextRecord,
} from "./canonical";
import { loadLocalLoreManifest } from "./manifest";

export type ImportLocalLoreOptions = {
  repositoryRoot: string;
  releaseId: string;
  manifestPath: string;
  sourceRoot: string;
  outputRoot?: string;
};

export type LocalImportReport = {
  status: "accepted" | "rejected";
  releaseId: string;
  acceptedCount: number;
  rejectedCount: number;
  inputChecksums: string[];
  outputChecksum: string | null;
  rejection: null | {
    reason: "canonical-validation-failed";
    sourcePaths: string[];
  };
};

function checksum(value: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function isContained(root: string, candidate: string): boolean {
  const fromRoot = relative(root, candidate);
  return fromRoot === "" || (!fromRoot.startsWith(`..${sep}`) && fromRoot !== ".." && !isAbsolute(fromRoot));
}

function assertSafeDirectoryPath(repositoryRoot: string, path: string): void {
  const relativePath = relative(repositoryRoot, path);
  let current = repositoryRoot;
  for (const segment of relativePath.split(sep).filter(Boolean)) {
    current = join(current, segment);
    if (!existsSync(current)) continue;
    const stats = lstatSync(current);
    if (stats.isSymbolicLink()) throw new Error(`output path contains a symlink: ${current}`);
    if (!stats.isDirectory()) throw new Error(`output path component is not a directory: ${current}`);
    if (realpathSync(current) !== current) throw new Error(`output path is not canonical: ${current}`);
  }
}

function ensureSafeDirectory(repositoryRoot: string, path: string): void {
  assertSafeDirectoryPath(repositoryRoot, path);
  mkdirSync(path, { recursive: true, mode: 0o700 });
  assertSafeDirectoryPath(repositoryRoot, path);
}

function validatedOutputRoot(options: ImportLocalLoreOptions): { repositoryRoot: string; localRoot: string; targetRoot: string } {
  const repositoryRoot = resolve(options.repositoryRoot);
  const repositoryStats = lstatSync(repositoryRoot);
  if (repositoryStats.isSymbolicLink() || !repositoryStats.isDirectory() || realpathSync(repositoryRoot) !== repositoryRoot) {
    throw new Error("repository root must be a canonical directory without symlinks");
  }
  const localRoot = resolve(repositoryRoot, ".local/offline-wiki");
  const targetRoot = resolve(options.outputRoot
    ?? join(localRoot, "imports", options.releaseId, "normalized"));
  if (!isContained(localRoot, targetRoot) || targetRoot === localRoot) {
    throw new Error("output target must remain below the repository .local/offline-wiki boundary");
  }
  assertSafeDirectoryPath(repositoryRoot, targetRoot);
  return { repositoryRoot, localRoot, targetRoot };
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

function rejectedReport(releaseId: string, sourcePaths: string[], inputChecksums: string[]): LocalImportReport {
  return {
    status: "rejected",
    releaseId,
    acceptedCount: 0,
    rejectedCount: 1,
    inputChecksums,
    outputChecksum: null,
    rejection: { reason: "canonical-validation-failed", sourcePaths },
  };
}

function promote(repositoryRoot: string, targetRoot: string, output: string, report: LocalImportReport): void {
  const parent = dirname(targetRoot);
  ensureSafeDirectory(repositoryRoot, parent);
  const stagingRoot = mkdtempSync(join(parent, ".normalized-staging-"));
  const backupRoot = `${targetRoot}.backup`;
  let backedUp = false;
  try {
    writeFileSync(join(stagingRoot, "current.jsonl"), output, { encoding: "utf8", mode: 0o600 });
    writeJson(join(stagingRoot, "report.json"), report);
    const stagedOutput = readFileSync(join(stagingRoot, "current.jsonl"), "utf8");
    const stagedRecords = stagedOutput.trim().length === 0
      ? []
      : stagedOutput.trimEnd().split("\n").map((line) => JSON.parse(line) as LocalFullTextRecord);
    validateLocalFullTextRecords(stagedRecords);
    if (checksum(stagedOutput) !== report.outputChecksum) {
      throw new Error("staged normalized overlay checksum mismatch");
    }
    const stagedReport = JSON.parse(readFileSync(join(stagingRoot, "report.json"), "utf8")) as unknown;
    if (JSON.stringify(stagedReport) !== JSON.stringify(report)) {
      throw new Error("staged import report did not round-trip");
    }
    if (existsSync(backupRoot)) {
      throw new Error("transaction backup already exists; refusing to overwrite it");
    }
    if (existsSync(targetRoot)) {
      renameSync(targetRoot, backupRoot);
      backedUp = true;
    }
    renameSync(stagingRoot, targetRoot);
  } catch (error) {
    if (backedUp && existsSync(backupRoot)) renameSync(backupRoot, targetRoot);
    throw error;
  } finally {
    if (existsSync(stagingRoot)) rmSync(stagingRoot, { recursive: true, force: true });
  }
  if (backedUp) rmSync(backupRoot, { recursive: true, force: true });
}

export function importLocalLore(options: ImportLocalLoreOptions): LocalImportReport {
  const { repositoryRoot, localRoot, targetRoot } = validatedOutputRoot(options);
  const manifest = loadLocalLoreManifest(options.manifestPath, options.releaseId, options.sourceRoot);
  if (manifest.adapter !== "canonical-jsonl") {
    throw new Error(`Task 4 importer does not support adapter ${manifest.adapter}`);
  }
  const inputChecksums = manifest.files.map(({ checksum: value }) => value);
  const sourcePaths = manifest.files.map(({ path }) => path);
  let records: LocalFullTextRecord[] = [];
  try {
    if (manifest.files.length !== 1) throw new Error("canonical-jsonl manifests must declare exactly one input file");
    const text = readFileSync(resolve(options.sourceRoot, manifest.files[0].path), "utf8");
    records = parseCanonicalLoreJsonl(text, manifest);
    const logicalIds = new Set<string>();
    for (const record of records) {
      if (logicalIds.has(record.logicalId)) throw new Error("duplicate logicalId across manifest files");
      logicalIds.add(record.logicalId);
    }
  } catch {
    const report = rejectedReport(options.releaseId, sourcePaths, inputChecksums);
    const reportRoot = join(localRoot, "imports", options.releaseId, "reports");
    ensureSafeDirectory(repositoryRoot, reportRoot);
    writeJson(join(reportRoot, "last-rejected.json"), report);
    return report;
  }

  const output = serializeCanonicalLoreRecords(records);
  const report: LocalImportReport = {
    status: "accepted",
    releaseId: options.releaseId,
    acceptedCount: records.length,
    rejectedCount: 0,
    inputChecksums,
    outputChecksum: checksum(output),
    rejection: null,
  };
  promote(repositoryRoot, targetRoot, output, report);
  return report;
}
