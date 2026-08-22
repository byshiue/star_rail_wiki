import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import type { FeatureRevision, EquipmentRevision } from "../../src/domain/entities";
import type { GameReleaseBundle } from "../../src/domain/releases";
import { diffReleases } from "./diffReleases";
import { auditNumericTokens, extractCandidateEffects, type EffectSourceRevision } from "./extractEffects";
import { fetchSource } from "./fetchSource";
import { importStarRailRes } from "./importStarRailRes";
import { ApprovedSourceManifestSchema, requiredPaths, type ApprovedSourceManifest } from "./sourceManifest";

const CandidateDiscoverySchema = z.strictObject({
  status: z.literal("candidate"),
  gameVersion: z.string().regex(/^\d+\.\d+$/),
  officialNoticeUrl: z.url().refine((url) => /^https:\/\/www\.hoyolab\.com\/article(?:_pre)?\/\d+$/.test(url)),
  officialPublishedAt: z.iso.datetime(),
  dimbreathRevision: z.string().regex(/^[a-f0-9]{40}$/),
  dimbreathLabel: z.string().min(1),
  dimbreathCommittedAt: z.iso.datetime(),
  starRailResRevision: z.string().regex(/^[a-f0-9]{40}$/),
  starRailResCommittedAt: z.iso.datetime(),
});

type CandidateDiscovery = z.infer<typeof CandidateDiscoverySchema>;

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function format(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function jsonSha256(value: unknown): string {
  return sha256(new TextEncoder().encode(JSON.stringify(value)));
}

function topLevelField(pathValue: string): string {
  if (pathValue === "$") return "$";
  return pathValue.split(/[.[]/, 1)[0] ?? pathValue;
}

export function buildStableEntityDiff(previous: GameReleaseBundle, next: GameReleaseBundle) {
  const details = diffReleases(previous, next);
  const entries = details.map((entry) => ({
    logicalId: entry.logicalId,
    kind: entry.kind,
    changedFields: [...new Set(entry.changes.map(({ path: changePath }) => topLevelField(changePath)))].sort(),
    changeCount: entry.changes.length,
    changesSha256: jsonSha256(entry.changes),
  }));
  const kinds = ["added", "removed", "changed"] as const;
  const counts = Object.fromEntries(kinds.map((kind) => [
    kind, entries.filter((entry) => entry.kind === kind).length,
  ])) as Record<(typeof kinds)[number], number>;
  const fieldCounts = Object.fromEntries(kinds.map((kind) => {
    const fields = new Map<string, number>();
    for (const entry of entries.filter((candidate) => candidate.kind === kind)) {
      for (const field of entry.changedFields) fields.set(field, (fields.get(field) ?? 0) + 1);
    }
    return [kind, Object.fromEntries([...fields].sort(([left], [right]) => left.localeCompare(right)))];
  }));
  const summary = {
    counts: { ...counts, total: entries.length },
    fieldCounts,
    entries,
  };
  return {
    ...summary,
    checksums: {
      detailsSha256: jsonSha256(details),
      summarySha256: jsonSha256(summary),
    },
    details,
  };
}

export function validateCandidateIdentity(value: unknown, paths: readonly string[]): CandidateDiscovery {
  const sourceRevision = typeof value === "object" && value !== null
    ? (value as { starRailResRevision?: unknown }).starRailResRevision
    : null;
  if (typeof sourceRevision !== "string" || !/^[a-f0-9]{40}$/.test(sourceRevision)) {
    throw new Error("candidate must identify one immutable 40-character StarRailRes revision");
  }
  const candidate = CandidateDiscoverySchema.parse(value);
  if (new Set(paths).size !== requiredPaths.length
    || paths.length !== requiredPaths.length
    || requiredPaths.some((requiredPath) => !paths.includes(requiredPath))) {
    throw new Error("candidate must use the exact required source paths");
  }
  return candidate;
}

async function downloadImmutableSnapshot(
  candidate: CandidateDiscovery,
  sourceRoot: string,
): Promise<Record<string, string>> {
  const checksums: Record<string, string> = {};
  for (const sourcePath of requiredPaths) {
    const url = new URL(
      `${candidate.starRailResRevision}/${sourcePath}`,
      "https://raw.githubusercontent.com/Mar-7th/StarRailRes/",
    );
    if (!url.pathname.split("/").includes(candidate.starRailResRevision)) {
      throw new Error(`candidate URL lost immutable revision for ${sourcePath}`);
    }
    const response = await fetch(url, { headers: { "User-Agent": "star-rail-wiki-release-audit" } });
    if (!response.ok) throw new Error(`candidate source fetch failed (${response.status}) for ${sourcePath}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    const localPath = path.join(sourceRoot, sourcePath);
    await mkdir(path.dirname(localPath), { recursive: true });
    await writeFile(localPath, bytes);
    checksums[sourcePath] = sha256(bytes);
  }
  return checksums;
}

async function prepare(discoveryPath: string, output: string, currentReleaseRoot: string): Promise<void> {
  const candidate = validateCandidateIdentity(JSON.parse(await readFile(discoveryPath, "utf8")), requiredPaths);
  const sourceRoot = path.join(output, "source");
  await mkdir(sourceRoot, { recursive: true });
  const fileChecksums = await downloadImmutableSnapshot(candidate, sourceRoot);
  const manifest: ApprovedSourceManifest = ApprovedSourceManifestSchema.parse({
    releaseId: `${candidate.gameVersion}-cn-candidate-${candidate.starRailResRevision.slice(0, 8)}`,
    gameVersion: candidate.gameVersion,
    channel: "released",
    importedAt: candidate.starRailResCommittedAt,
    reviewedAt: null,
    previousReleaseId: null,
    sources: [{
      name: "Mar-7th/StarRailRes",
      baseUrl: "https://raw.githubusercontent.com/Mar-7th/StarRailRes",
      revision: candidate.starRailResRevision,
      gameVersion: candidate.gameVersion,
      channel: "released",
      retrievedAt: new Date().toISOString(),
      fileChecksums,
    }],
  });
  await writeFile(path.join(output, "source-manifest.json"), format(manifest), "utf8");

  // fetchSource re-reads every downloaded byte and verifies it against the now-fixed manifest SHA.
  const bundle = importStarRailRes(await fetchSource(manifest, sourceRoot));
  const effectSources: Array<FeatureRevision | EquipmentRevision | EffectSourceRevision> = [
    ...bundle.entities.equipment,
    ...bundle.entities.characters.flatMap((character) => [
      ...character.abilities, ...character.traces, ...character.eidolons,
    ]),
  ];
  const audits = effectSources.map((source) => ({ source, audit: auditNumericTokens(source) }));
  const candidates = effectSources.flatMap(extractCandidateEffects);
  const coverage = {
    totalSourceDescriptions: effectSources.length,
    numericSourceDescriptions: audits.filter(({ audit }) => audit.auditableTokens > 0).length,
    silentNumericSourceDescriptions: audits.filter(({ audit, source }) => (
      audit.auditableTokens > 0 && extractCandidateEffects(source).length === 0
    )).length,
    excludedStructuralNumericTokens: audits.reduce((sum, { audit }) => sum + audit.excludedStructuralTokens, 0),
    candidateNumericEffects: candidates.length,
  };
  if (coverage.silentNumericSourceDescriptions !== 0) {
    throw new Error(`candidate dry-run has ${coverage.silentNumericSourceDescriptions} silent numeric descriptions`);
  }

  const current = {
    release: JSON.parse(await readFile(path.join(currentReleaseRoot, "release.json"), "utf8")),
    entities: JSON.parse(await readFile(path.join(currentReleaseRoot, "entities.json"), "utf8")),
  } as GameReleaseBundle;
  const candidateBundle = structuredClone(bundle) as unknown as GameReleaseBundle;
  candidateBundle.entities.effects = candidates.map((candidate) => ({
    id: candidate.candidateId,
    ...candidate,
  })) as unknown as GameReleaseBundle["entities"]["effects"];
  const entityDiff = buildStableEntityDiff(current, candidateBundle);
  await Promise.all([
    writeFile(path.join(output, "discovery.json"), format(candidate), "utf8"),
    writeFile(path.join(output, "coverage.json"), format(coverage), "utf8"),
    writeFile(path.join(output, "entity-diff.json"), format(entityDiff), "utf8"),
    writeFile(path.join(output, "candidate-audit.json"), format({
      status: "dry-run-complete",
      immutableSourceRevision: candidate.starRailResRevision,
      exactSourcePaths: [...requiredPaths],
      sourceChecksums: fileChecksums,
      coverage,
      entityDiff,
    }), "utf8"),
  ]);
}

function option(name: string): string {
  const index = process.argv.indexOf(name);
  const value = process.argv[index + 1];
  if (index < 0 || !value || value.startsWith("--")) throw new Error(`missing required option ${name}`);
  return value;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await prepare(option("--discovery"), option("--output"), option("--current-release-root"));
}
