import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { countPdfPages } from "./pdf/inspect";

const ChecksumSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const SafeHtmlFilenameSchema = z.string().regex(/^[^/\\]+\.html$/);
const SafePdfFilenameSchema = z.string().regex(/^[^/\\]+\.pdf$/);
const BuildManifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  releaseId: z.string().min(1),
  inputs: z.array(z.strictObject({ filename: SafeHtmlFilenameSchema, checksum: ChecksumSchema })),
  outputs: z.array(z.strictObject({
    filename: SafePdfFilenameSchema,
    checksum: ChecksumSchema,
    pageCount: z.number().int().positive(),
  })),
});

const REQUIRED_PDFS = [
  "00-总索引.pdf",
  "01-角色图鉴.pdf",
  "02-光锥图鉴.pdf",
  "03-遗器图鉴.pdf",
  "04-差分宇宙-索引.pdf",
  "05-世界观-索引.pdf",
  "06-剧情-索引.pdf",
  "07-文本收藏-索引.pdf",
];

export type VerifyOfflineWikiOptions = { outputRoot: string; releaseId: string };
export type VerificationReport = { releaseId: string; verifiedFiles: number; pages: number };

function checksum(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function verifyOfflineWiki(options: VerifyOfflineWikiOptions): VerificationReport {
  const buildRoot = join(options.outputRoot, "builds", options.releaseId);
  const manifest = BuildManifestSchema.parse(JSON.parse(readFileSync(join(buildRoot, "build-manifest.json"), "utf8")));
  if (manifest.releaseId !== options.releaseId) throw new Error("build manifest release does not match requested release");
  const inputNames = manifest.inputs.map((item) => item.filename);
  const outputNames = manifest.outputs.map((item) => item.filename);
  const expectedOutputNames = inputNames.map((filename) => filename.replace(/\.html$/, ".pdf"));
  if (new Set(inputNames).size !== inputNames.length || new Set(outputNames).size !== outputNames.length) {
    throw new Error("build manifest filenames must be unique");
  }
  if (JSON.stringify(outputNames) !== JSON.stringify(expectedOutputNames)
      || REQUIRED_PDFS.some((filename) => !outputNames.includes(filename))) {
    throw new Error("build manifest HTML/PDF volumes do not match the required canonical indexes");
  }

  for (const input of manifest.inputs) {
    const bytes = readFileSync(join(buildRoot, "html", input.filename));
    if (checksum(bytes) !== input.checksum) throw new Error(`HTML checksum mismatch: ${input.filename}`);
  }
  let pages = 0;
  for (const output of manifest.outputs) {
    const bytes = readFileSync(join(buildRoot, "pdf", output.filename));
    if (!bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error(`invalid PDF header: ${output.filename}`);
    if (checksum(bytes) !== output.checksum) throw new Error(`PDF checksum mismatch: ${output.filename}`);
    const pageCount = countPdfPages(bytes);
    if (pageCount !== output.pageCount) throw new Error(`PDF page count mismatch: ${output.filename}`);
    pages += pageCount;
  }
  return { releaseId: options.releaseId, verifiedFiles: manifest.outputs.length, pages };
}

function runCli(): void {
  const arguments_ = process.argv.slice(2);
  const releaseIndex = arguments_.indexOf("--release");
  const releaseId = releaseIndex === -1 ? undefined : arguments_[releaseIndex + 1];
  if (!releaseId) throw new Error("usage: npm run docs:verify -- --release <exact-release-id>");
  const report = verifyOfflineWiki({
    outputRoot: join(process.cwd(), ".local", "offline-wiki"),
    releaseId,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
