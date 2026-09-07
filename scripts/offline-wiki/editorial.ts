import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  DivergentUniverseEntrySchema,
  ReviewedSummarySchema,
  type DivergentUniverseEntry,
  type ReviewedSummary,
} from "./schema";

export type EditorialData = {
  summaries: ReviewedSummary[];
  divergentUniverse: DivergentUniverseEntry[];
};

export function parseReviewedSummary(value: unknown): ReviewedSummary {
  const summary = ReviewedSummarySchema.parse(value);
  const checksum = `sha256:${createHash("sha256").update(summary.summary, "utf8").digest("hex")}`;
  if (summary.contentChecksum !== checksum) {
    throw new Error(`summary checksum does not match reviewed text for ${summary.logicalId}`);
  }
  return summary;
}

export function parseDivergentUniverseEntry(value: unknown): DivergentUniverseEntry {
  return DivergentUniverseEntrySchema.parse(value);
}

function readArray(path: string): unknown[] {
  return z.array(z.unknown()).parse(JSON.parse(readFileSync(path, "utf8")));
}

export function loadEditorialData(root: string): EditorialData {
  const summaries = ["characters.json", "light-cones.json", "relics.json", "divergent-universe.json"]
    .flatMap((filename) => readArray(join(root, "summaries", filename)).map(parseReviewedSummary));
  const divergentUniverse = readArray(join(root, "divergent-universe", "entries.json"))
    .map(parseDivergentUniverseEntry);
  return { summaries, divergentUniverse };
}
