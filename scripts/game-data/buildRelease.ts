import { mkdir, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { fetchSource } from "./fetchSource";
import { importStarRailRes } from "./importStarRailRes";
import { assertReleasedChannel } from "./releaseGuard";
import { assertRequiredPaths, loadSourceManifest, type ApprovedSourceManifest } from "./sourceManifest";
import type { GameReleaseBundle } from "../../src/domain/releases";

export interface BuildReleaseInput {
  manifest: ApprovedSourceManifest;
  sourceRoot?: string;
}

export async function buildRelease(input: BuildReleaseInput): Promise<GameReleaseBundle> {
  assertReleasedChannel(input.manifest);
  assertRequiredPaths(input.manifest);
  return importStarRailRes(await fetchSource(input.manifest, input.sourceRoot));
}

export async function writeRelease(bundle: GameReleaseBundle, output: string): Promise<void> {
  await mkdir(output, { recursive: true });
  const format = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  await Promise.all([
    writeFile(`${output}/release.json`, format(bundle.release), "utf8"),
    writeFile(`${output}/entities.json`, format(bundle.entities), "utf8"),
  ]);
}

function option(name: string): string {
  const index = process.argv.indexOf(name);
  const value = process.argv[index + 1];
  if (index < 0 || !value || value.startsWith("--")) throw new Error(`missing required option ${name}`);
  return value;
}

async function main(): Promise<void> {
  const version = option("--version");
  const sourceRevision = option("--source-revision");
  const manifestPath = option("--manifest");
  const output = option("--output");
  const sourceRootIndex = process.argv.indexOf("--source-root");
  const sourceRoot = sourceRootIndex >= 0 ? process.argv[sourceRootIndex + 1] : undefined;
  const manifest = await loadSourceManifest(manifestPath);
  if (manifest.gameVersion !== version) {
    throw new Error(`manifest version mismatch: expected ${version}, received ${manifest.gameVersion}`);
  }
  if (!manifest.sources.some((source) => source.revision === sourceRevision)) {
    throw new Error(`source revision ${sourceRevision} is not present in the reviewed manifest`);
  }
  await writeRelease(await buildRelease({ manifest, sourceRoot }), output);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
