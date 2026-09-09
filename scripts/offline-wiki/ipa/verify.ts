import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { countPdfPages } from "../pdf/inspect";
import type { IpaBuildManifest } from "./build";

export type VerifyIpaLoreOptions = { repositoryRoot: string; releaseId: string };
export type IpaVerificationReport = { releaseId: string; volumes: number; pages: number; records: number };

function checksum(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function sameNames(actual: string[], expected: string[]): boolean {
  return JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
}

export function verifyIpaLoreBuild(options: VerifyIpaLoreOptions): IpaVerificationReport {
  if (!/^4\.5-cn-\d{4}-\d{2}-\d{2}$/u.test(options.releaseId)) throw new Error("invalid IPA verification release");
  const importRoot = join(resolve(options.repositoryRoot), ".local", "offline-wiki", "ipa-imports", options.releaseId);
  const buildRoot = join(importRoot, "build");
  const archiveBytes = readFileSync(join(importRoot, "archive.jsonl"));
  const auditBytes = readFileSync(join(importRoot, "audit.json"));
  const manifest = JSON.parse(readFileSync(join(buildRoot, "build-manifest.json"), "utf8")) as IpaBuildManifest;
  if (manifest.schemaVersion !== 1 || manifest.releaseId !== options.releaseId || manifest.summaryFallbackCount !== 0) {
    throw new Error("IPA build manifest identity mismatch");
  }
  if (manifest.archiveChecksum !== checksum(archiveBytes)) throw new Error("archive checksum mismatch");
  if (manifest.auditChecksum !== checksum(auditBytes)) throw new Error("audit checksum mismatch");
  const audit = JSON.parse(auditBytes.toString("utf8")) as { summaryFallbackCount?: unknown };
  if (audit.summaryFallbackCount !== 0) throw new Error("audit contains a summary fallback");

  const htmlNames = readdirSync(join(buildRoot, "html")).filter((name) => name.endsWith(".html"));
  const pdfNames = readdirSync(join(buildRoot, "pdf")).filter((name) => name.endsWith(".pdf"));
  const expectedHtml = manifest.inputs.map((input) => input.filename);
  const expectedPdf = manifest.outputs.map((output) => output.filename);
  if (!sameNames(htmlNames, expectedHtml) || !sameNames(pdfNames, expectedPdf)) throw new Error("build file set does not match manifest");
  if (manifest.inputs.length !== manifest.outputs.length || manifest.inputs.length === 0) throw new Error("HTML/PDF volume count mismatch");

  let pages = 0;
  for (const [index, input] of manifest.inputs.entries()) {
    if (!/^[^/\\]+\.html$/u.test(input.filename)) throw new Error(`unsafe HTML filename ${input.filename}`);
    const html = readFileSync(join(buildRoot, "html", input.filename));
    if (checksum(html) !== input.checksum) throw new Error(`HTML checksum mismatch: ${input.filename}`);
    const output = manifest.outputs[index]!;
    if (output.filename !== input.filename.replace(/\.html$/u, ".pdf") || output.recordCount !== input.recordCount) {
      throw new Error(`HTML/PDF metadata mismatch: ${input.filename}`);
    }
    if (!/^[^/\\]+\.pdf$/u.test(output.filename)) throw new Error(`unsafe PDF filename ${output.filename}`);
    const pdf = readFileSync(join(buildRoot, "pdf", output.filename));
    if (checksum(pdf) !== output.checksum) throw new Error(`PDF checksum mismatch: ${output.filename}`);
    if (!pdf.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error(`invalid PDF header: ${output.filename}`);
    const pageCount = countPdfPages(pdf);
    if (pageCount !== output.pageCount) throw new Error(`PDF page count mismatch: ${output.filename}`);
    pages += pageCount;
  }

  const records = archiveBytes.toString("utf8").split("\n").filter(Boolean).length;
  const index = manifest.inputs.find((input) => input.filename === "00-总索引.html");
  const contentRecords = manifest.inputs.filter((input) => input.filename !== "00-总索引.html").reduce((sum, input) => sum + input.recordCount, 0);
  if (!index || index.recordCount !== records || contentRecords !== records) throw new Error("manifest record totals do not match archive");
  return { releaseId: options.releaseId, volumes: manifest.outputs.length, pages, records };
}

function main(): void {
  const arguments_ = process.argv.slice(2);
  const index = arguments_.indexOf("--release");
  const releaseId = index < 0 ? undefined : arguments_[index + 1];
  if (!releaseId) throw new Error("usage: npm run docs:verify-ipa-lore -- --release <release-id>");
  const repositoryRoot = resolve(fileURLToPath(new URL("../../..", import.meta.url)));
  process.stdout.write(`${JSON.stringify(verifyIpaLoreBuild({ repositoryRoot, releaseId }), null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
