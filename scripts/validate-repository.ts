import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { EffectSchema } from "../src/domain/effects";
import { GameReleaseBundleSchema, ReleaseEntitiesSchema, ReleaseIndexSchema } from "../src/domain/releases";
import { EffectOverlayFileSchema, applyEffectOverlays } from "./game-data/applyEffectOverlays";
import { assertComplete, buildCoverageReport, collectEffectSources, CoverageReportSchema } from "./game-data/checkEffectCoverage";
import { extractCandidateEffects } from "./game-data/extractEffects";

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf8"));
}

function stable(value: unknown): string {
  return JSON.stringify(value);
}

export async function validateRepository(repositoryRoot = "."): Promise<void> {
  const releaseRoot = path.join(repositoryRoot, "public/data/releases");
  const releaseIndex = ReleaseIndexSchema.parse(await readJson(path.join(releaseRoot, "index.json")));
  const overlayFile = EffectOverlayFileSchema.parse(
    await readJson(path.join(repositoryRoot, "data/manual/effects.json")),
  );

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
    GameReleaseBundleSchema.parse({ release, entities });

    const checkedInCoverage = CoverageReportSchema.parse(
      await readJson(path.join(directory, "coverage.json")),
    );
    const actualCoverage = buildCoverageReport(entities, effects);
    if (stable(checkedInCoverage) !== stable(actualCoverage)) {
      throw new Error(`coverage report mismatch for ${indexedRelease.id}`);
    }
    assertComplete(actualCoverage);

    const candidates = collectEffectSources(entities).flatMap(extractCandidateEffects);
    const applied = applyEffectOverlays(candidates, overlayFile.overlays);
    const reviewedPayload = effects
      .filter((effect) => effect.reviewStatus !== "generated")
      .sort((left, right) => left.id.localeCompare(right.id));
    if (stable(applied) !== stable(reviewedPayload)) {
      throw new Error(`reviewed effect overlay mismatch for ${indexedRelease.id}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await validateRepository();
}
