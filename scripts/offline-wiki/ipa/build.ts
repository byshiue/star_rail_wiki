import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { renderPdfWithPlaywright, type PdfRenderer } from "../pdf/render";
import { renderArchiveVolumes } from "./render";
import type { StoryArchive, StoryFamily, StoryRecord } from "./story-schema";

export type IpaBuildManifest = {
  schemaVersion: 1;
  releaseId: string;
  summaryFallbackCount: 0;
  archiveChecksum: string;
  auditChecksum: string;
  inputs: Array<{ filename: string; checksum: string; recordCount: number }>;
  outputs: Array<{ filename: string; checksum: string; pageCount: number; family: StoryFamily | null; recordCount: number }>;
};

export type BuildIpaLoreOptions = {
  repositoryRoot: string;
  releaseId: string;
  renderPdf?: PdfRenderer;
  maxBodyCharacters?: number;
};

function checksum(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function readArchive(path: string): StoryArchive {
  const records: StoryRecord[] = [];
  for (const [index, line] of readFileSync(path, "utf8").split("\n").entries()) {
    if (!line) continue;
    let value: unknown;
    try { value = JSON.parse(line); } catch { throw new Error(`archive JSONL line ${index + 1} is invalid`); }
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`archive JSONL line ${index + 1} is not an object`);
    const candidate = value as StoryRecord;
    if (candidate.schemaVersion !== 1 || !candidate.logicalId || !candidate.name || !Array.isArray(candidate.sections)
      || candidate.sections.length === 0 || candidate.sections.some((section) => !section.body)) {
      throw new Error(`archive JSONL line ${index + 1} is incomplete`);
    }
    records.push(candidate);
  }
  return { schemaVersion: 1, records, rejections: [] };
}

function validateRelease(releaseId: string): void {
  if (!/^4\.5-cn-\d{4}-\d{2}-\d{2}$/u.test(releaseId)) throw new Error(`invalid IPA build release ${releaseId}`);
}

export async function buildIpaLore(options: BuildIpaLoreOptions): Promise<IpaBuildManifest> {
  validateRelease(options.releaseId);
  const importRoot = join(resolve(options.repositoryRoot), ".local", "offline-wiki", "ipa-imports", options.releaseId);
  const archivePath = join(importRoot, "archive.jsonl");
  const auditPath = join(importRoot, "audit.json");
  const archiveBytes = readFileSync(archivePath);
  const auditBytes = readFileSync(auditPath);
  const audit = JSON.parse(auditBytes.toString("utf8")) as { releaseId?: unknown; summaryFallbackCount?: unknown };
  if (audit.releaseId !== options.releaseId) throw new Error("audit release does not match requested build");
  if (audit.summaryFallbackCount !== 0) throw new Error("archive audit contains a summary fallback");
  const archive = readArchive(archivePath);
  const volumes = renderArchiveVolumes(archive, { maxBodyCharacters: options.maxBodyCharacters });
  const renderPdf = options.renderPdf ?? renderPdfWithPlaywright;
  const target = join(importRoot, "build");
  const token = randomUUID();
  const staging = join(importRoot, `.build-staging-${token}`);
  const backup = join(importRoot, `.build-backup-${token}`);
  mkdirSync(join(staging, "html"), { recursive: true });
  mkdirSync(join(staging, "pdf"), { recursive: true });
  const manifest: IpaBuildManifest = {
    schemaVersion: 1,
    releaseId: options.releaseId,
    summaryFallbackCount: 0,
    archiveChecksum: checksum(archiveBytes),
    auditChecksum: checksum(auditBytes),
    inputs: [],
    outputs: [],
  };
  let backedUp = false;
  try {
    for (const volume of volumes) {
      const htmlBytes = Buffer.from(volume.html, "utf8");
      writeFileSync(join(staging, "html", volume.filename), htmlBytes, { flag: "wx" });
      manifest.inputs.push({ filename: volume.filename, checksum: checksum(htmlBytes), recordCount: volume.recordCount });
      const pdf = await renderPdf({ html: volume.html, title: volume.title });
      const pdfBytes = Buffer.from(pdf.bytes);
      if (!pdfBytes.subarray(0, 5).equals(Buffer.from("%PDF-")) || pdf.pageCount < 1) {
        throw new Error(`renderer returned an invalid PDF for ${volume.filename}`);
      }
      const pdfFilename = volume.filename.replace(/\.html$/u, ".pdf");
      writeFileSync(join(staging, "pdf", pdfFilename), pdfBytes, { flag: "wx" });
      manifest.outputs.push({
        filename: pdfFilename,
        checksum: checksum(pdfBytes),
        pageCount: pdf.pageCount,
        family: volume.family,
        recordCount: volume.recordCount,
      });
    }
    writeFileSync(join(staging, "build-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
    if (existsSync(target)) {
      renameSync(target, backup);
      backedUp = true;
    }
    try {
      renameSync(staging, target);
    } catch (error) {
      if (backedUp && !existsSync(target)) renameSync(backup, target);
      throw error;
    }
    if (backedUp) rmSync(backup, { recursive: true });
  } finally {
    if (existsSync(staging)) rmSync(staging, { recursive: true });
  }
  return manifest;
}

async function main(): Promise<void> {
  const arguments_ = process.argv.slice(2);
  const index = arguments_.indexOf("--release");
  const releaseId = index < 0 ? undefined : arguments_[index + 1];
  if (!releaseId) throw new Error("usage: npm run docs:build-ipa-lore -- --release <release-id>");
  const repositoryRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
  const manifest = await buildIpaLore({ repositoryRoot, releaseId });
  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
