import { mkdir, readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { fetchSource } from "./fetchSource";
import { importStarRailRes } from "./importStarRailRes";
import { applyRoleAnnotations, loadRoleAnnotations, type RoleAnnotationRecord } from "./applyRoleAnnotations";
import { assertReleasedChannel } from "./releaseGuard";
import { assertRequiredPaths, loadSourceManifest, type ApprovedSourceManifest } from "./sourceManifest";
import { GameReleaseBundleSchema, type GameReleaseBundle } from "../../src/domain/releases";
import { EffectOverlayFileSchema, applyEffectOverlays, type EffectOverlay } from "./applyEffectOverlays";
import { assertComplete, buildCoverageReport, collectEffectSources } from "./checkEffectCoverage";
import { extractCandidateEffects } from "./extractEffects";

export interface BuildReleaseInput {
  manifest: ApprovedSourceManifest;
  sourceRoot?: string;
  overlays?: readonly EffectOverlay[];
  roleAnnotations?: readonly RoleAnnotationRecord[];
}

export async function buildRelease(input: BuildReleaseInput): Promise<GameReleaseBundle> {
  assertReleasedChannel(input.manifest);
  assertRequiredPaths(input.manifest);
  const unannotated = importStarRailRes(await fetchSource(input.manifest, input.sourceRoot));
  const bundle = applyRoleAnnotations(unannotated, input.roleAnnotations ?? await loadRoleAnnotations());
  if (input.overlays === undefined) return bundle;

  const candidates = collectEffectSources(bundle.entities).flatMap(extractCandidateEffects);
  const candidateIds = new Set(candidates.map((candidate) => candidate.candidateId));
  bundle.entities.effects = applyEffectOverlays(candidates, input.overlays.filter((overlay) => candidateIds.has(overlay.candidateId)));
  const reviewStatusesByRevision = new Map<string, Set<"reviewed" | "unsupported">>();
  for (const effect of bundle.entities.effects) {
    const statuses = reviewStatusesByRevision.get(effect.sourceRevisionId) ?? new Set<"reviewed" | "unsupported">();
    if (effect.reviewStatus !== "generated") statuses.add(effect.reviewStatus);
    reviewStatusesByRevision.set(effect.sourceRevisionId, statuses);
  }
  for (const source of collectEffectSources(bundle.entities)) {
    const statuses = reviewStatusesByRevision.get(source.revisionId);
    if (statuses?.has("reviewed")) source.reviewStatus = "reviewed";
    else if (statuses?.has("unsupported")) source.reviewStatus = "unsupported";
  }
  const effectIdsByRevision = new Map<string, string[]>();
  for (const effect of bundle.entities.effects) {
    const ids = effectIdsByRevision.get(effect.sourceRevisionId) ?? [];
    ids.push(effect.id);
    effectIdsByRevision.set(effect.sourceRevisionId, ids);
  }
  for (const source of collectEffectSources(bundle.entities)) {
    source.effectIds = effectIdsByRevision.get(source.revisionId)?.sort() ?? [];
  }
  assertComplete(buildCoverageReport(bundle.entities, bundle.entities.effects));
  return GameReleaseBundleSchema.parse(bundle);
}

export async function loadEffectOverlays(file = "data/manual/effects.json"): Promise<EffectOverlay[]> {
  return EffectOverlayFileSchema.parse(JSON.parse(await readFile(file, "utf8"))).overlays;
}

export async function writeRelease(bundle: GameReleaseBundle, output: string): Promise<void> {
  await mkdir(output, { recursive: true });
  const format = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
  await Promise.all([
    writeFile(`${output}/release.json`, format(bundle.release), "utf8"),
    writeFile(`${output}/entities.json`, format(bundle.entities), "utf8"),
    writeFile(`${output}/effects.json`, format(bundle.entities.effects), "utf8"),
    writeFile(`${output}/coverage.json`, format(buildCoverageReport(bundle.entities, bundle.entities.effects)), "utf8"),
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
  const rolesIndex = process.argv.indexOf("--roles");
  const rolesFile = rolesIndex >= 0 ? process.argv[rolesIndex + 1] : undefined;
  if (rolesIndex >= 0 && !rolesFile) throw new Error("missing required option --roles");
  const overlaysIndex = process.argv.indexOf("--overlays");
  const overlaysFile = overlaysIndex >= 0 ? process.argv[overlaysIndex + 1] : undefined;
  if (overlaysIndex >= 0 && !overlaysFile) throw new Error("missing required option --overlays");
  const manifest = await loadSourceManifest(manifestPath);
  if (manifest.gameVersion !== version) {
    throw new Error(`manifest version mismatch: expected ${version}, received ${manifest.gameVersion}`);
  }
  if (!manifest.sources.some((source) => source.revision === sourceRevision)) {
    throw new Error(`source revision ${sourceRevision} is not present in the reviewed manifest`);
  }
  await writeRelease(await buildRelease({ manifest, sourceRoot, overlays: await loadEffectOverlays(overlaysFile), roleAnnotations: await loadRoleAnnotations(rolesFile) }), output);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
