import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { CoverageReport } from "./game-data/checkEffectCoverage";
import type { GameReleaseBundle } from "../src/domain/releases";
import { ApprovedSourceManifestSchema } from "./game-data/sourceManifest";

const DateString = z.string().refine((value) => Number.isFinite(Date.parse(value)), "invalid date");
const AuditSchema = z.strictObject({
  schemaVersion: z.literal(1), asOf: DateString, region: z.literal("cn"), decision: z.string().min(1),
  channelAuthority: z.strictObject({
    name: z.string().min(1), url: z.literal("https://www.hoyolab.com/article/45851903"),
    publishedAt: DateString, retrievedAt: DateString, releaseStartsAt: DateString, releaseEndsAt: DateString,
  }),
  releasedClientEvidence: z.strictObject({
    name: z.string().min(1), url: z.url(), revision: z.string().regex(/^[a-f0-9]{40}$/),
    committedAt: DateString, label: z.string().regex(/^OSPRODWin4\.4\.0_/), retrievedAt: DateString,
  }),
  contentSource: z.strictObject({
    name: z.string().min(1), url: z.url(), revision: z.string().regex(/^[a-f0-9]{40}$/),
    committedAt: DateString, versionCommit: z.string().regex(/^[a-f0-9]{40}$/),
    license: z.literal("AGPL-3.0"), retrievedAt: DateString,
  }),
  excludedSourceRecords: z.strictObject({
    characterRanks: z.strictObject({
      count: z.number().int().nonnegative(), classification: z.literal("enhanced-alternate"),
      reason: z.string().min(1), idListSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    }),
    characterSkills: z.strictObject({ count: z.literal(0), classification: z.literal("none") }),
    characterSkillTrees: z.strictObject({ count: z.literal(0), classification: z.literal("none") }),
  }),
});

async function json(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf8"));
}

export async function validateProductionAudit(
  root: string, bundle: GameReleaseBundle, coverage: CoverageReport,
): Promise<void> {
  if (bundle.release.id !== "4.4-cn-2026-08-21") return;
  const auditRoot = path.join(root, "data/releases", bundle.release.id);
  const audit = AuditSchema.parse(await json(path.join(auditRoot, "audit.json")));
  const manifest = ApprovedSourceManifestSchema.parse(await json(path.join(auditRoot, "source-manifest.json")));
  if (manifest.releaseId !== bundle.release.id || manifest.gameVersion !== bundle.release.gameVersion) {
    throw new Error("production source manifest does not match release identity");
  }
  const source = bundle.release.sources.find(({ revision }) => revision === audit.contentSource.revision);
  if (!source || !manifest.sources.some(({ revision }) => revision === audit.contentSource.revision)) {
    throw new Error("production content revision is not pinned by release and manifest");
  }
  const asOf = Date.parse(audit.asOf);
  if (asOf < Date.parse(audit.channelAuthority.releaseStartsAt) || asOf >= Date.parse(audit.channelAuthority.releaseEndsAt)) {
    throw new Error("production audit date is outside the official released-version window");
  }
  const counts = {
    characters: bundle.entities.characters.length,
    abilities: bundle.entities.characters.reduce((total, character) => total + character.abilities.length, 0),
    traces: bundle.entities.characters.reduce((total, character) => total + character.traces.length, 0),
    eidolons: bundle.entities.characters.reduce((total, character) => total + character.eidolons.length, 0),
    equipment: bundle.entities.equipment.length,
  };
  if (JSON.stringify(counts) !== JSON.stringify({ characters: 95, abilities: 762, traces: 1912, eidolons: 570, equipment: 225 })) {
    throw new Error(`production entity audit changed: ${JSON.stringify(counts)}`);
  }
  if (audit.excludedSourceRecords.characterRanks.count !== 60) throw new Error("production orphan classification count changed");
  if (coverage.candidateNumericEffects !== 939 || coverage.reviewedEffects !== 39
    || coverage.explicitUnsupportedEffects !== 900 || coverage.generatedEffects !== 0 || coverage.unmappedEffects !== 0) {
    throw new Error(`production effect audit changed: ${JSON.stringify(coverage)}`);
  }
}
