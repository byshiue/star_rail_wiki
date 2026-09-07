import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { loadDocumentCatalog } from "./catalog";
import { compareDocumentCatalogs, type DocumentChanges } from "./changes";
import { loadEditorialData } from "./editorial";

export type PrepareOptions = {
  releasesRoot: string;
  releaseId: string;
  outputRoot: string;
  editorialRoot?: string;
};

export type PrepareReport = {
  schemaVersion: 1;
  releaseId: string;
  gameVersion: string;
  counts: {
    characters: number;
    lightCones: number;
    relicSets: number;
    divergentUniverse: number;
  };
  gaps: {
    storySummaries: number;
    images: number;
    divergentUniverse: number;
  };
  changes: DocumentChanges;
};

function writeJsonAtomically(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
  renameSync(temporaryPath, path);
}

export function prepareOfflineWiki(options: PrepareOptions): PrepareReport {
  const editorialData = options.editorialRoot ? loadEditorialData(options.editorialRoot) : undefined;
  const catalog = loadDocumentCatalog(options.releasesRoot, options.releaseId, editorialData);
  const previousCatalog = catalog.release.previousReleaseId
    ? loadDocumentCatalog(options.releasesRoot, catalog.release.previousReleaseId, editorialData)
    : null;
  const storyEntityCount = catalog.characters.length + catalog.lightCones.length + catalog.relicSets.length;
  const report: PrepareReport = {
    schemaVersion: 1,
    releaseId: catalog.release.id,
    gameVersion: catalog.release.gameVersion,
    counts: {
      characters: catalog.characters.length,
      lightCones: catalog.lightCones.length,
      relicSets: catalog.relicSets.length,
      divergentUniverse: catalog.divergentUniverse.length,
    },
    gaps: {
      storySummaries: catalog.summaryCoverage.missing,
      images: storyEntityCount,
      divergentUniverse: 0,
    },
    changes: compareDocumentCatalogs(previousCatalog, catalog),
  };
  writeJsonAtomically(
    join(options.outputRoot, "builds", options.releaseId, "prepare-report.json"),
    report,
  );
  return report;
}

function readOption(arguments_: string[], name: string): string | undefined {
  const index = arguments_.indexOf(name);
  return index === -1 ? undefined : arguments_[index + 1];
}

function runCli(): void {
  const releaseId = readOption(process.argv.slice(2), "--release");
  if (!releaseId) throw new Error("usage: npm run docs:prepare -- --release <exact-release-id>");

  const report = prepareOfflineWiki({
    releasesRoot: join(process.cwd(), "public", "data", "releases"),
    releaseId,
    outputRoot: join(process.cwd(), ".local", "offline-wiki"),
    editorialRoot: join(process.cwd(), "data", "offline-wiki"),
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
