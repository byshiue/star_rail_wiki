import { readFileSync } from "node:fs";
import { join } from "node:path";
import { GameReleaseBundleSchema } from "../../src/domain/releases";
import type { EditorialData } from "./editorial";
import { loadLoreCatalog, type LoreCatalog } from "./lore/catalog";
import { buildLoreCoverage, loadLocalImportReport } from "./lore/coverage";
import { loadLocalFullTextOverlay } from "./lore/local-overlay";
import type { LoreFamily, LoreRecord } from "./lore/schema";
import { DocumentCatalogSchema, type DocumentCatalog } from "./schema";

const RELEASE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const LORE_FAMILIES: LoreFamily[] = ["divergent-universe", "worldview", "mission", "collectible"];

export type LoadDocumentCatalogOptions = {
  loreRoot?: string;
  localOverlayPath?: string;
  localImportReportPath?: string;
};

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function compareChineseName(left: { name: string; logicalId: string }, right: { name: string; logicalId: string }) {
  return left.name.localeCompare(right.name, "zh-CN") || left.logicalId.localeCompare(right.logicalId);
}

function emptyLoreCatalog(releaseId: string): LoreCatalog {
  const byFamily: LoreCatalog["byFamily"] = {
    "divergent-universe": [],
    worldview: [],
    mission: [],
    collectible: [],
  };
  return {
    releaseId,
    records: [],
    byFamily,
    baselines: LORE_FAMILIES.map((family) => ({
      releaseId,
      family,
      baselineStatus: "missing",
      expectedCount: null,
      provenance: [],
      contentChecksum: `sha256:${"0".repeat(64)}`,
    })),
  };
}

type InvalidRelationshipCounts = Partial<Record<LoreFamily, Partial<Record<string, number>>>>;

export function filterInvalidLoreRelationships(
  records: readonly LoreRecord[],
  releasedEntityIds: ReadonlySet<string>,
): { records: LoreRecord[]; invalidRelationships: InvalidRelationshipCounts } {
  const loreIds = new Set(records.map((record) => record.logicalId));
  const invalidRelationships: InvalidRelationshipCounts = {};
  const increment = (record: LoreRecord) => {
    const family = invalidRelationships[record.family] ??= {};
    family[record.kind] = (family[record.kind] ?? 0) + 1;
  };
  const filtered = records.map((record) => {
    const seen = new Set<string>();
    const relationships = record.relationships.filter((relationship) => {
      const identity = `${relationship.type}\0${relationship.targetLogicalId}\0${relationship.external}`;
      if (seen.has(identity)) {
        increment(record);
        return false;
      }
      seen.add(identity);
      if (relationship.external) return true;
      if (relationship.targetLogicalId.startsWith("lore:")) {
        if (!loreIds.has(relationship.targetLogicalId)) {
          throw new Error(`lore relationship from ${record.logicalId} targets missing ${relationship.targetLogicalId}`);
        }
        return true;
      }
      if (!releasedEntityIds.has(relationship.targetLogicalId)) {
        increment(record);
        return false;
      }
      return true;
    });
    return relationships.length === record.relationships.length ? record : { ...record, relationships };
  });
  return { records: filtered, invalidRelationships };
}

function byFamily(records: readonly LoreRecord[]): LoreCatalog["byFamily"] {
  return {
    "divergent-universe": records.filter((record) => record.family === "divergent-universe"),
    worldview: records.filter((record) => record.family === "worldview"),
    mission: records.filter((record) => record.family === "mission"),
    collectible: records.filter((record) => record.family === "collectible"),
  };
}

export function loadDocumentCatalog(
  releasesRoot: string,
  releaseId: string,
  editorialData: EditorialData = { summaries: [], divergentUniverse: [] },
  options: LoadDocumentCatalogOptions = {},
): DocumentCatalog {
  if (!RELEASE_ID_PATTERN.test(releaseId) || releaseId.toLowerCase() === "latest") {
    throw new Error(`offline wiki requires an exact release id; received ${JSON.stringify(releaseId)}`);
  }

  const releaseRoot = join(releasesRoot, releaseId);
  const bundle = GameReleaseBundleSchema.parse({
    release: readJson(join(releaseRoot, "release.json")),
    entities: readJson(join(releaseRoot, "entities.json")),
  });
  if (bundle.release.id !== releaseId) {
    throw new Error(`release directory ${releaseId} contains release ${bundle.release.id}`);
  }

  const characters = [...bundle.entities.characters].sort(compareChineseName);
  const lightCones = bundle.entities.equipment
    .filter((item) => item.kind === "light-cone")
    .sort(compareChineseName);
  const relicSets = bundle.entities.equipment
    .filter((item) => item.kind === "relic-set")
    .sort(compareChineseName);
  const storyEntityIds = new Set([
    ...characters.map((item) => item.logicalId),
    ...lightCones.map((item) => item.logicalId),
    ...relicSets.map((item) => item.logicalId),
  ]);
  const availableSummaryIds = new Set(editorialData.summaries
    .filter((summary) => summary.releaseId === releaseId && storyEntityIds.has(summary.logicalId))
    .map((summary) => summary.logicalId));
  const reviewedSummaryIds = new Set(editorialData.summaries
    .filter((summary) => summary.releaseId === releaseId
      && summary.reviewStatus === "reviewed"
      && storyEntityIds.has(summary.logicalId))
    .map((summary) => summary.logicalId));
  const autoGeneratedSummaryIds = new Set(editorialData.summaries
    .filter((summary) => summary.releaseId === releaseId
      && summary.reviewStatus === "auto-generated"
      && storyEntityIds.has(summary.logicalId))
    .map((summary) => summary.logicalId));
  const committedLore = options.loreRoot
    ? loadLoreCatalog(options.loreRoot, releaseId)
    : emptyLoreCatalog(releaseId);
  const releasedEntityIds = new Set([
    ...characters.map((item) => item.logicalId),
    ...lightCones.map((item) => item.logicalId),
    ...relicSets.map((item) => item.logicalId),
  ]);
  const processedLore = filterInvalidLoreRelationships(committedLore.records, releasedEntityIds);
  const loreCatalog: LoreCatalog = {
    ...committedLore,
    records: processedLore.records,
    byFamily: byFamily(processedLore.records),
  };
  const localOverlay = loadLocalFullTextOverlay(options.localOverlayPath, releaseId, loreCatalog.records);
  const loreCoverage = buildLoreCoverage({
    catalog: loreCatalog,
    summaries: editorialData.summaries,
    localOverlay,
    importReport: loadLocalImportReport(options.localImportReportPath),
    invalidRelationships: processedLore.invalidRelationships,
  });

  return DocumentCatalogSchema.parse({
    release: bundle.release,
    characters,
    lightCones,
    relicSets,
    divergentUniverse: editorialData.divergentUniverse
      .filter((item) => item.releaseId === releaseId)
      .sort(compareChineseName),
    lore: loreCatalog.records,
    loreCoverage,
    summaryCoverage: {
      available: availableSummaryIds.size,
      reviewed: reviewedSummaryIds.size,
      autoGenerated: autoGeneratedSummaryIds.size,
      missing: storyEntityIds.size - availableSummaryIds.size,
    },
  });
}
