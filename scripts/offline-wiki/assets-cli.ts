import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { downloadAsset, type DownloadedAsset } from "./assets/download";
import { loadAssetManifest } from "./assets/manifest";
import { loadDocumentCatalog } from "./catalog";

export type AssetDownloadReport = {
  releaseId: string;
  downloaded: DownloadedAsset[];
};

async function runCli(): Promise<void> {
  const arguments_ = process.argv.slice(2);
  const releaseIndex = arguments_.indexOf("--release");
  const releaseId = releaseIndex === -1 ? undefined : arguments_[releaseIndex + 1];
  if (!releaseId) throw new Error("usage: npm run docs:assets -- --release <exact-release-id>");

  loadDocumentCatalog(join(process.cwd(), "public", "data", "releases"), releaseId);
  const assets = loadAssetManifest(join(process.cwd(), "data", "offline-wiki", "assets.json"));
  const outputRoot = join(process.cwd(), ".local", "offline-wiki", "assets", releaseId);
  const allowedHosts = [...new Set(assets.map((asset) => asset.allowedHost))];
  const downloaded: DownloadedAsset[] = [];
  for (const asset of assets) downloaded.push(await downloadAsset(asset, { outputRoot, allowedHosts }));

  mkdirSync(outputRoot, { recursive: true });
  const report: AssetDownloadReport = { releaseId, downloaded };
  writeFileSync(join(outputRoot, "asset-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
