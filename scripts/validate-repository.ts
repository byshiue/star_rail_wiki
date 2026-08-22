import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { EffectSchema, type Effect } from "../src/domain/effects";
import { GameReleaseBundleSchema, ReleaseEntitiesSchema, ReleaseIndexSchema, type GameReleaseBundle } from "../src/domain/releases";
import { EffectOverlayFileSchema, applyEffectOverlays } from "./game-data/applyEffectOverlays";
import { assertComplete, buildCoverageReport, collectEffectSources, CoverageReportSchema } from "./game-data/checkEffectCoverage";
import { extractCandidateEffects, type CandidateEffect } from "./game-data/extractEffects";
import { validateCommunityRepository } from "./validate-community-teams";
import { assertRoleAnnotations, loadRoleAnnotations } from "./game-data/applyRoleAnnotations";
import { validatePublicProfileRepository } from "./validate-public-profiles";
import { validateProductionAudit } from "./validate-production-audit";

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf8"));
}

function stable(value: unknown): string {
  return JSON.stringify(value);
}

export async function validateRepository(repositoryRoot = "."): Promise<void> {
  const releaseRoot = path.join(repositoryRoot, "public/data/releases");
  const releaseIndex = ReleaseIndexSchema.parse(await readJson(path.join(releaseRoot, "index.json")));
  if (releaseIndex.currentReleaseId !== null) {
    const current = releaseIndex.releases.find((release) => release.id === releaseIndex.currentReleaseId);
    if (current?.channel === "fixture" || current?.id.toLowerCase().includes("fixture")) {
      throw new Error(`fixture cannot be the production current release: ${current.id}`);
    }
  }
  const overlayFile = EffectOverlayFileSchema.parse(
    await readJson(path.join(repositoryRoot, "data/manual/effects.json")),
  );
  const allCandidates: CandidateEffect[] = [];
  const allReviewedEffects: Effect[] = [];
  const roleAnnotations = await loadRoleAnnotations(path.join(repositoryRoot, "data/manual/character-roles.json"));
  const bundles = new Map<string, GameReleaseBundle>();

  for (const indexedRelease of releaseIndex.releases) {
    const directory = path.join(releaseRoot, indexedRelease.id);
    const release = await readJson(path.join(directory, "release.json"));
    if (stable(release) !== stable(indexedRelease)) {
      throw new Error(`release index mismatch for ${indexedRelease.id}`);
    }

    const entities = ReleaseEntitiesSchema.parse(await readJson(path.join(directory, "entities.json")));
    const effects = z.array(EffectSchema).parse(await readJson(path.join(directory, "effects.json")));
    if (stable(entities.effects) !== stable(effects)) {
      throw new Error(`independent effects payload mismatch for ${indexedRelease.id}`);
    }
    const bundle = GameReleaseBundleSchema.parse({ release, entities });
    bundles.set(bundle.release.id, bundle);
    assertRoleAnnotations(bundle, roleAnnotations);

    const checkedInCoverage = CoverageReportSchema.parse(
      await readJson(path.join(directory, "coverage.json")),
    );
    const actualCoverage = buildCoverageReport(entities, effects);
    if (stable(checkedInCoverage) !== stable(actualCoverage)) {
      throw new Error(`coverage report mismatch for ${indexedRelease.id}`);
    }
    assertComplete(actualCoverage);
    await validateProductionAudit(repositoryRoot, bundle, actualCoverage);

    allCandidates.push(...collectEffectSources(entities).flatMap(extractCandidateEffects));
    allReviewedEffects.push(...effects.filter((effect) => effect.reviewStatus !== "generated"));
  }

  const applied = applyEffectOverlays(allCandidates, overlayFile.overlays);
  const reviewedPayload = allReviewedEffects.sort((left, right) => left.id.localeCompare(right.id));
  if (stable(applied) !== stable(reviewedPayload)) {
    throw new Error("reviewed effect overlay mismatch");
  }

  const communityPath = path.join(repositoryRoot, "data/community/teams.json");
  const publicCommunityPath = path.join(repositoryRoot, "public/data/community/teams.json");
  const community = await readJson(communityPath);
  if (stable(community) !== stable(await readJson(publicCommunityPath))) {
    throw new Error("public community team payload mismatch");
  }
  validateCommunityRepository(community, releaseIndex, bundles);
  await validatePublicProfileRepository(repositoryRoot);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await validateRepository();
}
