import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadAssetManifest } from "./assets/manifest";
import { loadDocumentCatalog } from "./catalog";
import { compareDocumentCatalogs } from "./changes";
import { loadEditorialData } from "./editorial";
import { loadLocalFullTextOverlay } from "./lore/local-overlay";
import { loadCachedRenderAssets } from "./render/assets";
import { renderLoreVolumes } from "./render/lore-volumes";
import { renderVolumes, type RenderedVolume } from "./render/volumes";

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
  buildRootOverride?: string;
  operations?: {
    afterCatalogLoaded?: () => void;
  };
};

export type HtmlOutput = Pick<RenderedVolume, "filename" | "family" | "group"> & { path: string };

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
  const localImportReportPath = options.localImportReportPath
    ?? join(localOverlayPath, "..", "..", "reports", "last-rejected.json");
  let localOverlay: ReturnType<typeof loadLocalFullTextOverlay> | undefined;
  const catalog = loadDocumentCatalog(options.releasesRoot, options.releaseId, editorial, {
    loreRoot,
    localOverlayPath,
    localImportReportPath,
    onLocalOverlayLoaded: (snapshot) => { localOverlay = new Map(snapshot); },
  });
  if (!localOverlay) throw new Error("document catalog did not bind a local overlay snapshot");
  options.operations?.afterCatalogLoaded?.();

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
  const buildRoot = options.buildRootOverride ?? join(options.outputRoot, "previews", options.releaseId);
  const outputDirectory = join(buildRoot, "html");
  mkdirSync(buildRoot, { recursive: true });
  const baseVolumes = renderVolumes({
    catalog,
    summaries: editorial.summaries,
    assets,
    changes: compareDocumentCatalogs(previousCatalog, catalog),
  });
  const loreVolumes = renderLoreVolumes({ catalog, summaries: editorial.summaries, localOverlay });
  const volumes = [...baseVolumes, ...loreVolumes];
  const stagingDirectory = mkdtempSync(join(buildRoot, ".html-staging-"));
  const backupDirectory = join(buildRoot, `.html-backup-${randomUUID()}`);
  let backedUp = false;
  try {
    for (const volume of volumes) writeAtomically(join(stagingDirectory, volume.filename), volume.html);
    if (existsSync(outputDirectory)) {
      renameSync(outputDirectory, backupDirectory);
      backedUp = true;
    }
    try {
      renameSync(stagingDirectory, outputDirectory);
    } catch (error) {
      if (backedUp && !existsSync(outputDirectory)) renameSync(backupDirectory, outputDirectory);
      throw error;
    }
    if (backedUp) rmSync(backupDirectory, { recursive: true });
  } finally {
    if (existsSync(stagingDirectory)) rmSync(stagingDirectory, { recursive: true });
  }
  return volumes.map((volume) => ({
    filename: volume.filename,
    path: join(outputDirectory, volume.filename),
    family: volume.family,
    group: volume.group,
  }));
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
