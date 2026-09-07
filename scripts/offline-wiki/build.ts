import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
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
};

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
};

function checksum(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function writeAtomically(path: string, bytes: Uint8Array): void {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, bytes, { flag: "wx" });
  renameSync(temporaryPath, path);
}

export async function buildOfflineWiki(options: BuildOfflineWikiOptions): Promise<BuildManifest> {
  if (/[/\\]/u.test(options.releaseId)) throw new Error("releaseId must not contain path separators");
  const buildsRoot = join(options.outputRoot, "builds");
  const finalBuildRoot = join(buildsRoot, options.releaseId);
  mkdirSync(buildsRoot, { recursive: true });
  const stagingBuildRoot = mkdtempSync(join(buildsRoot, `.${options.releaseId}.staging-`));
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

    const manifest: BuildManifest = { schemaVersion: 2, releaseId: options.releaseId, inputs, outputs };
    writeAtomically(
      join(stagingBuildRoot, "build-manifest.json"),
      Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
    );
    verifyBuildRoot(stagingBuildRoot, options.releaseId);

    if (!existsSync(finalBuildRoot)) {
      renameSync(stagingBuildRoot, finalBuildRoot);
      return manifest;
    }
    const existing = lstatSync(finalBuildRoot);
    if (!existing.isDirectory() || existing.isSymbolicLink()) {
      throw new Error("existing release build root must be a real directory");
    }
    const backupBuildRoot = `${finalBuildRoot}.backup-${process.pid}-${Date.now()}`;
    renameSync(finalBuildRoot, backupBuildRoot);
    try {
      renameSync(stagingBuildRoot, finalBuildRoot);
    } catch (error) {
      renameSync(backupBuildRoot, finalBuildRoot);
      throw error;
    }
    rmSync(backupBuildRoot, { recursive: true, force: true });
    return manifest;
  } finally {
    if (existsSync(stagingBuildRoot)) rmSync(stagingBuildRoot, { recursive: true, force: true });
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
