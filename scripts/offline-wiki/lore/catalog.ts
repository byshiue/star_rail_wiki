import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import {
  LoreBaselineSchema,
  LoreRecordSchema,
  type LoreBaseline,
  type LoreFamily,
  type LoreRecord,
} from "./schema";

const RELEASE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const FAMILY_FILES: ReadonlyArray<readonly [LoreFamily, string]> = [
  ["divergent-universe", "divergent-universe.json"],
  ["worldview", "worldview.json"],
  ["mission", "missions.json"],
  ["collectible", "collectibles.json"],
];

export type LoreCatalog = {
  releaseId: string;
  records: LoreRecord[];
  byFamily: Record<LoreFamily, LoreRecord[]>;
  baselines: LoreBaseline[];
};

function readArray(path: string): unknown[] {
  return z.array(z.unknown()).parse(JSON.parse(readFileSync(path, "utf8")));
}

function canonicalProvenance(provenance: LoreRecord["provenance"]): LoreRecord["provenance"] {
  return provenance.map((source) => ({
    sourceName: source.sourceName,
    sourceUrl: source.sourceUrl,
    sourceRevision: source.sourceRevision,
    sourcePath: source.sourcePath,
    sourceChecksum: source.sourceChecksum,
  }));
}

function canonicalRecord(record: LoreRecord): object {
  const common = {
    logicalId: record.logicalId,
    name: record.name,
    aliases: record.aliases,
    releaseId: record.releaseId,
    locale: record.locale,
    description: record.description,
    relationships: record.relationships.map((relationship) => ({
      type: relationship.type,
      targetLogicalId: relationship.targetLogicalId,
      external: relationship.external,
    })),
    provenance: canonicalProvenance(record.provenance),
    reviewStatus: record.reviewStatus,
    family: record.family,
    kind: record.kind,
  };

  if (record.family !== "divergent-universe" || record.mechanics === undefined) {
    return common;
  }

  return {
    ...common,
    mechanics: {
      rarity: record.mechanics.rarity,
      path: record.mechanics.path,
      activationRequirement: record.mechanics.activationRequirement,
      enhancementRequirement: record.mechanics.enhancementRequirement,
      effect: record.mechanics.effect,
      enhancedEffect: record.mechanics.enhancedEffect,
    },
  };
}

function canonicalBaseline(baseline: LoreBaseline): object {
  return {
    releaseId: baseline.releaseId,
    family: baseline.family,
    baselineStatus: baseline.baselineStatus,
    expectedCount: baseline.expectedCount,
    provenance: canonicalProvenance(baseline.provenance),
  };
}

function checksum(value: object): string {
  return `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;
}

function verifyChecksum(
  kind: "lore record" | "lore baseline",
  logicalId: string,
  expected: string,
  canonicalValue: object,
): void {
  if (checksum(canonicalValue) !== expected) {
    throw new Error(`${kind} checksum mismatch for ${logicalId}`);
  }
}

function compareChineseName(left: LoreRecord, right: LoreRecord): number {
  return left.name.localeCompare(right.name, "zh-CN") || left.logicalId.localeCompare(right.logicalId);
}

export function validateLoreRelationships(records: LoreRecord[]): void {
  const loreIds = new Set(records.map((record) => record.logicalId));
  for (const record of records) {
    for (const relationship of record.relationships) {
      if (!relationship.external
        && relationship.targetLogicalId.startsWith("lore:")
        && !loreIds.has(relationship.targetLogicalId)) {
        throw new Error(
          `lore relationship from ${record.logicalId} targets missing ${relationship.targetLogicalId}`,
        );
      }
    }
  }
}

export function loadLoreCatalog(root: string, releaseId: string): LoreCatalog {
  if (!RELEASE_ID_PATTERN.test(releaseId) || releaseId.toLowerCase() === "latest") {
    throw new Error(`offline wiki lore requires an exact release id; received ${JSON.stringify(releaseId)}`);
  }

  const releaseRoot = join(root, releaseId);
  const records: LoreRecord[] = [];
  for (const [family, filename] of FAMILY_FILES) {
    for (const value of readArray(join(releaseRoot, filename))) {
      const record = LoreRecordSchema.parse(value);
      if (record.family !== family) {
        throw new Error(`${filename} contains ${record.family} lore record ${record.logicalId}`);
      }
      if (record.releaseId !== releaseId) {
        throw new Error(`lore record ${record.logicalId} belongs to release ${record.releaseId}`);
      }
      verifyChecksum("lore record", record.logicalId, record.contentChecksum, canonicalRecord(record));
      records.push(record);
    }
  }

  const seenIds = new Set<string>();
  for (const record of records) {
    if (seenIds.has(record.logicalId)) {
      throw new Error(`duplicate lore logical id ${record.logicalId}`);
    }
    seenIds.add(record.logicalId);
  }
  validateLoreRelationships(records);

  const baselines = readArray(join(releaseRoot, "baselines.json")).map((value) => {
    const baseline = LoreBaselineSchema.parse(value);
    if (baseline.releaseId !== releaseId) {
      throw new Error(`lore baseline ${baseline.family} belongs to release ${baseline.releaseId}`);
    }
    verifyChecksum("lore baseline", baseline.family, baseline.contentChecksum, canonicalBaseline(baseline));
    return baseline;
  });

  const sortedRecords = [...records].sort(compareChineseName);
  return {
    releaseId,
    records: sortedRecords,
    byFamily: {
      "divergent-universe": sortedRecords.filter((record) => record.family === "divergent-universe"),
      worldview: sortedRecords.filter((record) => record.family === "worldview"),
      mission: sortedRecords.filter((record) => record.family === "mission"),
      collectible: sortedRecords.filter((record) => record.family === "collectible"),
    },
    baselines,
  };
}
