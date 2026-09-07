import { createHash } from "node:crypto";
import {
  lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync,
  type Stats,
} from "node:fs";
import { basename, dirname, join, parse, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { buildHtmlVolumes } from "./build-html";
import { renderPdfWithPlaywright, type PdfRenderer } from "./pdf/render";
import type { LoreFamily } from "./schema";
import { verifyBuildRoot } from "./verify";

export type BuildOfflineWikiOptions = {
  releasesRoot: string;
  editorialRoot: string;
  releaseId: string;
  outputRoot: string;
  loreRoot?: string;
  localOverlayPath?: string;
  localImportReportPath?: string;
  renderPdf?: PdfRenderer;
  fileOperationsForTest?: { removeBackup: (path: string) => void };
};

export type BuildWarning = "backup-cleanup-pending";

export type BuildManifest = {
  schemaVersion: 2;
  releaseId: string;
  inputs: Array<{ filename: string; checksum: string }>;
  outputs: Array<{
    filename: string;
    checksum: string;
    pageCount: number;
    family: LoreFamily | null;
    group: string;
    order: number;
  }>;
  warnings: BuildWarning[];
};

type DirectoryIdentity = { path: string; device: number; inode: number };

function lstatMaybe(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function ensureCanonicalDirectory(path: string): string {
  const absolutePath = resolve(path);
  const root = parse(absolutePath).root;
  let current = root;
  for (const component of absolutePath.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, component);
    const existing = lstatMaybe(current);
    if (existing) {
      if (existing.isSymbolicLink()) throw new Error("canonical directory must not contain a symlink: " + current);
      if (!existing.isDirectory()) throw new Error("canonical directory component is not a directory: " + current);
    } else {
      mkdirSync(current);
    }
    if (realpathSync(current) !== current) throw new Error("directory is not canonical: " + current);
  }
  return absolutePath;
}

function captureDirectoryIdentity(path: string): DirectoryIdentity {
  const canonicalPath = ensureCanonicalDirectory(path);
  const stats = statSync(canonicalPath);
  return { path: canonicalPath, device: stats.dev, inode: stats.ino };
}

function assertDirectoryIdentity(identity: DirectoryIdentity): void {
  const stats = lstatSync(identity.path);
  if (stats.isSymbolicLink() || !stats.isDirectory() || realpathSync(identity.path) !== identity.path
      || stats.dev !== identity.device || stats.ino !== identity.inode) {
    throw new Error("builds parent identity changed or is not canonical: " + identity.path);
  }
}

function assertOwnedChild(identity: DirectoryIdentity, path: string, expectedName: string, mustExist: boolean): void {
  assertDirectoryIdentity(identity);
  if (dirname(resolve(path)) !== identity.path || basename(path) !== expectedName) {
    throw new Error("build path is not an expected child of the canonical builds directory: " + path);
  }
  const stats = lstatMaybe(path);
  if (!mustExist) {
    if (stats) throw new Error("build path already exists: " + path);
    return;
  }
  if (!stats || stats.isSymbolicLink() || !stats.isDirectory() || dirname(realpathSync(path)) !== identity.path) {
    throw new Error("build path must be a real canonical child directory: " + path);
  }
}

function removeOwnedDirectory(
  identity: DirectoryIdentity,
  path: string,
  expectedName: string,
  remove: (path: string) => void = (target) => rmSync(target, { recursive: true, force: false }),
): void {
  assertOwnedChild(identity, path, expectedName, true);
  remove(path);
}

function checksum(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function writeAtomically(path: string, bytes: Uint8Array): void {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, bytes, { flag: "wx" });
  renameSync(temporaryPath, path);
}

function readManifest(buildRoot: string): BuildManifest {
  return JSON.parse(readFileSync(join(buildRoot, "build-manifest.json"), "utf8")) as BuildManifest;
}

function writeManifest(buildRoot: string, manifest: BuildManifest): void {
  writeAtomically(
    join(buildRoot, "build-manifest.json"),
    Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
  );
}

function pendingBackupNames(buildsRoot: string, releaseId: string, identity: DirectoryIdentity): string[] {
  assertDirectoryIdentity(identity);
  const prefix = `${releaseId}.backup-`;
  const matches = readdirSync(buildsRoot).filter((name) => name.startsWith(prefix));
  if (matches.some((name) => !/^[A-Za-z0-9-]+$/u.test(name.slice(prefix.length)))) {
    throw new Error("ambiguous or non-canonical pending backup name");
  }
  return matches;
}

function recoverPendingBackup(identity: DirectoryIdentity, releaseId: string, finalBuildRoot: string): void {
  const backups = pendingBackupNames(identity.path, releaseId, identity);
  if (backups.length > 1) throw new Error("ambiguous pending backups; refusing to delete anything");
  const finalStats = lstatMaybe(finalBuildRoot);
  if (!finalStats) {
    if (backups.length > 0) throw new Error("pending backup exists without an active final build");
    return;
  }
  assertOwnedChild(identity, finalBuildRoot, releaseId, true);
  verifyBuildRoot(finalBuildRoot, releaseId);
  const activeManifest = readManifest(finalBuildRoot);
  if (backups.length === 0) {
    if (activeManifest.warnings.includes("backup-cleanup-pending")) {
      activeManifest.warnings = [];
      writeManifest(finalBuildRoot, activeManifest);
    }
    return;
  }
  if (!activeManifest.warnings.includes("backup-cleanup-pending")) {
    throw new Error("unrecognized pending backup; active manifest has no cleanup warning");
  }
  const backupName = backups[0]!;
  const backupRoot = join(identity.path, backupName);
  assertOwnedChild(identity, backupRoot, backupName, true);
  verifyBuildRoot(backupRoot, releaseId);
  removeOwnedDirectory(identity, backupRoot, backupName);
  activeManifest.warnings = [];
  writeManifest(finalBuildRoot, activeManifest);
}

export async function buildOfflineWiki(options: BuildOfflineWikiOptions): Promise<BuildManifest> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(options.releaseId)) {
    throw new Error("releaseId must be a safe single path component");
  }
  const outputRoot = ensureCanonicalDirectory(options.outputRoot);
  const buildsIdentity = captureDirectoryIdentity(join(outputRoot, "builds"));
  const finalBuildRoot = join(buildsIdentity.path, options.releaseId);
  recoverPendingBackup(buildsIdentity, options.releaseId, finalBuildRoot);
  const replacingExisting = lstatMaybe(finalBuildRoot) !== null;
  if (replacingExisting) assertOwnedChild(buildsIdentity, finalBuildRoot, options.releaseId, true);

  assertDirectoryIdentity(buildsIdentity);
  const stagingBuildRoot = mkdtempSync(join(buildsIdentity.path, `.${options.releaseId}.staging-`));
  const stagingName = basename(stagingBuildRoot);
  const stagingPrefix = "." + options.releaseId + ".staging-";
  if (!stagingName.startsWith(stagingPrefix) || !/^[A-Za-z0-9]+$/u.test(stagingName.slice(stagingPrefix.length))) {
    throw new Error("staging path has a non-canonical sibling basename");
  }
  assertOwnedChild(buildsIdentity, stagingBuildRoot, stagingName, true);
  let stagingExists = true;
  try {
    const htmlOutputs = buildHtmlVolumes({ ...options, buildRootOverride: stagingBuildRoot });
    const pdfRoot = join(stagingBuildRoot, "pdf");
    mkdirSync(pdfRoot, { recursive: true });
    const renderPdf = options.renderPdf ?? renderPdfWithPlaywright;
    const inputs: BuildManifest["inputs"] = [];
    const outputs: BuildManifest["outputs"] = [];

    for (const [order, htmlOutput] of htmlOutputs.entries()) {
      const htmlBytes = readFileSync(htmlOutput.path);
      inputs.push({ filename: htmlOutput.filename, checksum: checksum(htmlBytes) });
      const filename = htmlOutput.filename.replace(/\.html$/, ".pdf");
      const rendered = await renderPdf({
        html: htmlBytes.toString("utf8"),
        title: filename.replace(/\.pdf$/, ""),
      });
      writeAtomically(join(pdfRoot, filename), rendered.bytes);
      outputs.push({
        filename,
        checksum: checksum(rendered.bytes),
        pageCount: rendered.pageCount,
        family: htmlOutput.family,
        group: htmlOutput.group,
        order,
      });
    }

    const manifest: BuildManifest = {
      schemaVersion: 2,
      releaseId: options.releaseId,
      inputs,
      outputs,
      warnings: replacingExisting ? ["backup-cleanup-pending"] : [],
    };
    writeManifest(stagingBuildRoot, manifest);
    verifyBuildRoot(stagingBuildRoot, options.releaseId);

    if (!replacingExisting) {
      assertOwnedChild(buildsIdentity, stagingBuildRoot, stagingName, true);
      assertOwnedChild(buildsIdentity, finalBuildRoot, options.releaseId, false);
      renameSync(stagingBuildRoot, finalBuildRoot);
      stagingExists = false;
      return manifest;
    }

    const backupName = `${options.releaseId}.backup-${process.pid}-${Date.now()}`;
    const backupBuildRoot = join(buildsIdentity.path, backupName);
    assertOwnedChild(buildsIdentity, finalBuildRoot, options.releaseId, true);
    assertOwnedChild(buildsIdentity, backupBuildRoot, backupName, false);
    renameSync(finalBuildRoot, backupBuildRoot);
    try {
      assertOwnedChild(buildsIdentity, stagingBuildRoot, stagingName, true);
      assertOwnedChild(buildsIdentity, finalBuildRoot, options.releaseId, false);
      renameSync(stagingBuildRoot, finalBuildRoot);
      stagingExists = false;
    } catch (error) {
      assertOwnedChild(buildsIdentity, backupBuildRoot, backupName, true);
      assertOwnedChild(buildsIdentity, finalBuildRoot, options.releaseId, false);
      renameSync(backupBuildRoot, finalBuildRoot);
      throw error;
    }

    try {
      verifyBuildRoot(finalBuildRoot, options.releaseId);
    } catch (error) {
      assertOwnedChild(buildsIdentity, finalBuildRoot, options.releaseId, true);
      assertOwnedChild(buildsIdentity, stagingBuildRoot, stagingName, false);
      renameSync(finalBuildRoot, stagingBuildRoot);
      stagingExists = true;
      assertOwnedChild(buildsIdentity, backupBuildRoot, backupName, true);
      assertOwnedChild(buildsIdentity, finalBuildRoot, options.releaseId, false);
      renameSync(backupBuildRoot, finalBuildRoot);
      throw error;
    }
    try {
      removeOwnedDirectory(
        buildsIdentity,
        backupBuildRoot,
        backupName,
        options.fileOperationsForTest?.removeBackup,
      );
    } catch {
      return manifest;
    }

    manifest.warnings = [];
    try {
      writeManifest(finalBuildRoot, manifest);
      verifyBuildRoot(finalBuildRoot, options.releaseId);
    } catch {
      manifest.warnings = ["backup-cleanup-pending"];
    }
    return manifest;
  } finally {
    if (stagingExists && lstatMaybe(stagingBuildRoot)) {
      removeOwnedDirectory(buildsIdentity, stagingBuildRoot, stagingName);
    }
  }
}

function runCli(): Promise<void> {
  const arguments_ = process.argv.slice(2);
  const releaseIndex = arguments_.indexOf("--release");
  const releaseId = releaseIndex === -1 ? undefined : arguments_[releaseIndex + 1];
  if (!releaseId) throw new Error("usage: npm run docs:build -- --release <exact-release-id>");
  return buildOfflineWiki({
    releasesRoot: join(process.cwd(), "public", "data", "releases"),
    editorialRoot: join(process.cwd(), "data", "offline-wiki"),
    releaseId,
    outputRoot: join(process.cwd(), ".local", "offline-wiki"),
  }).then((manifest) => {
    process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
