import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { CoverageReportSchema, type CoverageReport } from "./game-data/checkEffectCoverage";
import type { GameReleaseBundle } from "../src/domain/releases";
import { ApprovedSourceManifestSchema } from "./game-data/sourceManifest";
import {
  CharacterRankOrphanAuditSchema,
  validateCharacterRankOrphanAudit,
} from "./game-data/orphanAudit";
import {
  assertReviewedSkillScalingEffects, ReviewedSkillScalingSnapshotSchema,
} from "./game-data/reviewedSkillScaling";

const DateString = z.string().refine((value) => Number.isFinite(Date.parse(value)), "invalid date");
const AuditSchema = z.strictObject({
  schemaVersion: z.literal(1), asOf: DateString, region: z.literal("cn"), decision: z.string().min(1),
  channelAuthority: z.strictObject({
    name: z.string().min(1), url: z.url(),
    publishedAt: DateString, retrievedAt: DateString, releaseStartsAt: DateString, releaseEndsAt: DateString,
  }),
  releasedClientEvidence: z.strictObject({
    name: z.string().min(1), url: z.url(), revision: z.string().regex(/^[a-f0-9]{40}$/),
    committedAt: DateString, label: z.string().regex(/^OSPRODWin\d+\.\d+\.0_/), retrievedAt: DateString,
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
  expectedEntityCounts: z.strictObject({
    characters: z.number().int().nonnegative(), abilities: z.number().int().nonnegative(),
    traces: z.number().int().nonnegative(), eidolons: z.number().int().nonnegative(),
    equipment: z.number().int().nonnegative(),
  }),
  expectedCoverage: CoverageReportSchema,
  normalization: z.strictObject({ unresolvedParameterTokens: z.literal(0) }),
});

async function json(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf8"));
}

async function immutableRawFile(
  auditRoot: string, sourcePath: string, expectedChecksum: string,
): Promise<{ value: unknown; checksum: string }> {
  const bytes = await readFile(path.join(auditRoot, "source", sourcePath));
  const checksum = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (checksum !== expectedChecksum) {
    throw new Error(`checked immutable raw source checksum mismatch for ${sourcePath}`);
  }
  return { value: JSON.parse(bytes.toString("utf8")), checksum };
}

export async function validateProductionAudit(
  root: string, bundle: GameReleaseBundle, coverage: CoverageReport,
): Promise<void> {
  if (bundle.release.channel !== "released") return;
  const auditRoot = path.join(root, "data/releases", bundle.release.id);
  const audit = AuditSchema.parse(await json(path.join(auditRoot, "audit.json")));
  const manifest = ApprovedSourceManifestSchema.parse(await json(path.join(auditRoot, "source-manifest.json")));
  if (manifest.releaseId !== bundle.release.id || manifest.gameVersion !== bundle.release.gameVersion) {
    throw new Error("production source manifest does not match release identity");
  }
  if (manifest.previousReleaseId !== bundle.release.previousReleaseId) {
    throw new Error("production source manifest previous release does not match release chain");
  }
  if (!audit.releasedClientEvidence.label.startsWith(`OSPRODWin${bundle.release.gameVersion}.0_`)) {
    throw new Error("released-client evidence label does not match game version");
  }
  const source = bundle.release.sources.find(({ revision }) => revision === audit.contentSource.revision);
  if (!source || !manifest.sources.some(({ revision }) => revision === audit.contentSource.revision)) {
    throw new Error("production content revision is not pinned by release and manifest");
  }
  const orphanReport = CharacterRankOrphanAuditSchema.parse(
    await json(path.join(auditRoot, "orphan-character-ranks.json")),
  );
  const manifestSource = manifest.sources.find(({ revision }) => revision === orphanReport.sourceRevision);
  if (
    orphanReport.releaseId !== bundle.release.id
    || orphanReport.sourceRevision !== audit.contentSource.revision
    || !manifestSource
    || manifestSource.fileChecksums[orphanReport.charactersPath] !== orphanReport.charactersFileChecksum
    || manifestSource.fileChecksums[orphanReport.characterRanksPath] !== orphanReport.characterRanksFileChecksum
  ) {
    throw new Error("orphan rank snapshot is not bound to the audited immutable source");
  }
  if (
    source.fileChecksums[orphanReport.charactersPath] !== orphanReport.charactersFileChecksum
    || source.fileChecksums[orphanReport.characterRanksPath] !== orphanReport.characterRanksFileChecksum
  ) {
    throw new Error("bundle source checksums do not match the immutable orphan source manifest");
  }
  const charactersRaw = await immutableRawFile(
    auditRoot, orphanReport.charactersPath, orphanReport.charactersFileChecksum,
  );
  const characterRanksRaw = await immutableRawFile(
    auditRoot, orphanReport.characterRanksPath, orphanReport.characterRanksFileChecksum,
  );
  const canonicalRankIds = bundle.entities.characters.flatMap((character) => (
    character.eidolons.map(({ logicalId }) => logicalId.replace(/^eidolon:/, ""))
  ));
  const validatedOrphans = validateCharacterRankOrphanAudit(orphanReport, {
    charactersValue: charactersRaw.value,
    characterRanksValue: characterRanksRaw.value,
    charactersChecksum: charactersRaw.checksum,
    characterRanksChecksum: characterRanksRaw.checksum,
  }, canonicalRankIds);
  if (
    validatedOrphans.orphanRankIds.length !== audit.excludedSourceRecords.characterRanks.count
    || validatedOrphans.orphanIdsSha256 !== audit.excludedSourceRecords.characterRanks.idListSha256
  ) {
    throw new Error("orphan rank count or sorted-list SHA-256 does not match production audit");
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
  if (JSON.stringify(counts) !== JSON.stringify(audit.expectedEntityCounts)) {
    throw new Error(`production entity audit changed: ${JSON.stringify(counts)}`);
  }
  if (JSON.stringify(coverage) !== JSON.stringify(audit.expectedCoverage)) {
    throw new Error(`production effect audit changed: ${JSON.stringify(coverage)}`);
  }
  const unresolvedParameterTokens = JSON.stringify(bundle).match(/#\d+\[[^\]]+\]/g)?.length ?? 0;
  if (unresolvedParameterTokens !== audit.normalization.unresolvedParameterTokens) {
    throw new Error(`production unresolved parameter token count changed: ${unresolvedParameterTokens}`);
  }
  if (bundle.release.id === "4.4-cn-2026-08-21") {
    const scaling = ReviewedSkillScalingSnapshotSchema.parse(
      await json(path.join(auditRoot, "reviewed-skill-scaling.json")),
    );
    const scalingSource = manifest.sources.find(({ revision }) => revision === scaling.sourceRevision);
    if (scaling.sourceRevision !== audit.contentSource.revision
      || scaling.sourcePath !== "index_new/cn/character_skills.json"
      || scalingSource?.fileChecksums[scaling.sourcePath] !== scaling.sourceChecksum) {
      throw new Error("reviewed skill scaling snapshot is not bound to the immutable production source");
    }
    const features = bundle.entities.characters.flatMap((character) => (
      [...character.abilities, ...character.traces, ...character.eidolons]
    ));
    for (const record of scaling.records) {
      const feature = features.find(({ logicalId }) => logicalId === record.featureLogicalId);
      if (!feature || feature.revisionId !== `${record.featureLogicalId}@${scaling.releaseId}`
        || !feature.provenance.some((source) => source.sourceRevision === scaling.sourceRevision
          && source.sourcePath === scaling.sourcePath && source.sourceChecksum === scaling.sourceChecksum)) {
        throw new Error(`reviewed skill scaling feature provenance drift: ${record.featureLogicalId}`);
      }
    }
    assertReviewedSkillScalingEffects(scaling, bundle.entities.effects);
  }
}
