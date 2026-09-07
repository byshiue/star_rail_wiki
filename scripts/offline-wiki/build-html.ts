import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAssetManifest } from "./assets/manifest";
import { loadDocumentCatalog } from "./catalog";
import { compareDocumentCatalogs } from "./changes";
import { loadEditorialData } from "./editorial";
import { loadLocalFullTextOverlay } from "./lore/local-overlay";
import { loadCachedRenderAssets } from "./render/assets";
import { renderLoreVolumes } from "./render/lore-volumes";
import { renderVolumes } from "./render/volumes";

export type BuildHtmlOptions = {
  releasesRoot: string;
  editorialRoot: string;
  releaseId: string;
  outputRoot: string;
  assetManifestPath?: string;
  assetCacheRoot?: string;
  loreRoot?: string;
  localOverlayPath?: string;
  localImportReportPath?: string;
};

export type HtmlOutput = { filename: string; path: string };

function writeAtomically(path: string, content: string): void {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, content, { flag: "wx" });
  renameSync(temporaryPath, path);
}

export function buildHtmlVolumes(options: BuildHtmlOptions): HtmlOutput[] {
  const editorial = loadEditorialData(options.editorialRoot);
  const loreRoot = options.loreRoot ?? join(options.editorialRoot, "lore");
  const localOverlayPath = options.localOverlayPath
    ?? join(process.cwd(), ".local", "offline-wiki", "imports", options.releaseId, "normalized", "current.jsonl");
  const catalog = loadDocumentCatalog(options.releasesRoot, options.releaseId, editorial, {
    loreRoot,
    localOverlayPath,
    localImportReportPath: options.localImportReportPath,
  });
  const previousCatalog = catalog.release.previousReleaseId
    ? loadDocumentCatalog(options.releasesRoot, catalog.release.previousReleaseId, editorial)
    : null;
  const assetManifest = loadAssetManifest(
    options.assetManifestPath ?? join(options.editorialRoot, "assets.json"),
  );
  const assets = loadCachedRenderAssets(
    assetManifest,
    options.assetCacheRoot ?? join(options.outputRoot, "assets", options.releaseId),
  );
  const outputDirectory = join(options.outputRoot, "builds", options.releaseId, "html");
  mkdirSync(outputDirectory, { recursive: true });
  const baseVolumes = renderVolumes({
    catalog,
    summaries: editorial.summaries,
    assets,
    changes: compareDocumentCatalogs(previousCatalog, catalog),
  });
  const localOverlay = loadLocalFullTextOverlay(localOverlayPath, options.releaseId, catalog.lore);
  const loreVolumes = renderLoreVolumes({ catalog, summaries: editorial.summaries, localOverlay });
  return [...baseVolumes, ...loreVolumes].map((volume) => {
    const path = join(outputDirectory, volume.filename);
    writeAtomically(path, volume.html);
    return { filename: volume.filename, path };
  });
}

function readOption(arguments_: string[], name: string): string | undefined {
  const index = arguments_.indexOf(name);
  return index === -1 ? undefined : arguments_[index + 1];
}

function runCli(): void {
  const releaseId = readOption(process.argv.slice(2), "--release");
  if (!releaseId) throw new Error("usage: npm run docs:html -- --release <exact-release-id>");
  const outputs = buildHtmlVolumes({
    releasesRoot: join(process.cwd(), "public", "data", "releases"),
    editorialRoot: join(process.cwd(), "data", "offline-wiki"),
    releaseId,
    outputRoot: join(process.cwd(), ".local", "offline-wiki"),
  });
  process.stdout.write(`${outputs.map(({ path }) => path).join("\n")}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
