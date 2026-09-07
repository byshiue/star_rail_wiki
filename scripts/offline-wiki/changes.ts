import type { FeatureRevision } from "../../src/domain/entities";
import type { DocumentCatalog } from "./schema";

export type DocumentChanges = {
  baselineReleaseId: string | null;
  added: string[];
  changed: string[];
  unchanged: string[];
  removed: string[];
};

function featureContent(feature: FeatureRevision): unknown {
  return { name: feature.name, kind: feature.kind, originalText: feature.originalText };
}

function documentContent(catalog: DocumentCatalog): Map<string, unknown> {
  return new Map([
    ...catalog.characters.map((character) => [character.logicalId, {
      name: character.name,
      rarity: character.rarity,
      element: character.element,
      path: character.path,
      description: character.description,
      abilities: character.abilities.map(featureContent),
      traces: character.traces.map(featureContent),
      eidolons: character.eidolons.map(featureContent),
    }] as [string, unknown]),
    ...catalog.lightCones.map((item) => [item.logicalId, {
      kind: item.kind,
      name: item.name,
      rarity: item.rarity,
      description: item.description,
      pathRestriction: item.pathRestriction,
      superimpositionValues: item.superimpositionValues,
    }] as [string, unknown]),
    ...catalog.relicSets.map((item) => [item.logicalId, {
      kind: item.kind,
      name: item.name,
      description: item.description,
      setThresholds: item.setThresholds,
    }] as [string, unknown]),
    ...catalog.divergentUniverse.map((item) => [item.logicalId, {
      kind: item.kind,
      name: item.name,
      description: item.description,
    }] as [string, unknown]),
  ]);
}

export function compareDocumentCatalogs(
  previous: DocumentCatalog | null,
  current: DocumentCatalog,
): DocumentChanges {
  const before = previous ? documentContent(previous) : new Map<string, unknown>();
  const after = documentContent(current);
  const ids = [...new Set([...before.keys(), ...after.keys()])].sort();
  const result: DocumentChanges = {
    baselineReleaseId: previous?.release.id ?? null,
    added: [],
    changed: [],
    unchanged: [],
    removed: [],
  };
  for (const id of ids) {
    if (!before.has(id)) result.added.push(id);
    else if (!after.has(id)) result.removed.push(id);
    else if (JSON.stringify(before.get(id)) === JSON.stringify(after.get(id))) result.unchanged.push(id);
    else result.changed.push(id);
  }
  return result;
}
