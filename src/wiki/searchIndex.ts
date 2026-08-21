import type { EffectMetric, ReviewStatus } from "../domain/effects";
import type { CharacterRevision, EquipmentRevision } from "../domain/entities";
import type { GameReleaseBundle } from "../domain/releases";

export type WikiEntityKind = "character" | "light-cone" | "relic-set";
export type WikiSearchDocument = {
  id: string; kind: WikiEntityKind; name: string; description: string;
  rarity: number | null; element: string | null; path: string | null;
  reviewStatus: ReviewStatus; metrics: EffectMetric[]; searchableText: string;
};
export type WikiSearchIndex = { releaseId: string; documents: WikiSearchDocument[] };
export type WikiSearchFilters = {
  kinds?: WikiEntityKind[]; elements?: string[]; paths?: string[]; rarities?: number[];
  metrics?: EffectMetric[]; reviewStatuses?: ReviewStatus[];
};
export type SearchResult = WikiSearchDocument;

const punctuation = /[\s，。！？；：、“”‘’（）【】《》,.!?;:'"()[\]<>]+/gu;

export function normalizeWikiText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase("zh-CN").replace(punctuation, "");
}

function characterDocument(bundle: GameReleaseBundle, character: CharacterRevision): WikiSearchDocument {
  const features = [...character.abilities, ...character.traces, ...character.eidolons];
  const revisionIds = new Set(features.map((feature) => feature.revisionId));
  const effects = bundle.entities.effects.filter((effect) => revisionIds.has(effect.sourceRevisionId));
  return {
    id: character.logicalId, kind: "character", name: character.name,
    description: character.description, rarity: character.rarity, element: character.element,
    path: character.path, reviewStatus: character.reviewStatus,
    metrics: [...new Set(effects.map((effect) => effect.metric))],
    searchableText: normalizeWikiText([
      character.name, character.description, character.element, character.path,
      ...features.flatMap((feature) => [feature.name, feature.kind, feature.originalText]),
      ...effects.flatMap((effect) => [effect.originalText, effect.metric]),
    ].join(" ")),
  };
}

function equipmentDocument(bundle: GameReleaseBundle, equipment: EquipmentRevision): WikiSearchDocument {
  const effects = bundle.entities.effects.filter((effect) => effect.sourceRevisionId === equipment.revisionId);
  return {
    id: equipment.logicalId, kind: equipment.kind, name: equipment.name,
    description: equipment.description, rarity: equipment.rarity, element: null,
    path: equipment.pathRestriction, reviewStatus: equipment.reviewStatus,
    metrics: [...new Set(effects.map((effect) => effect.metric))],
    searchableText: normalizeWikiText([
      equipment.name, equipment.description, equipment.pathRestriction ?? "",
      ...effects.flatMap((effect) => [effect.originalText, effect.metric]),
      ...equipment.superimpositionValues.map(String), ...equipment.setThresholds.map(String),
    ].join(" ")),
  };
}

export function buildSearchIndex(bundle: GameReleaseBundle): WikiSearchIndex {
  return { releaseId: bundle.release.id, documents: [
    ...bundle.entities.characters.map((character) => characterDocument(bundle, character)),
    ...bundle.entities.equipment.map((equipment) => equipmentDocument(bundle, equipment)),
  ] };
}

function intersects<T>(actual: T[], selected: T[] | undefined): boolean {
  return !selected?.length || selected.some((value) => actual.includes(value));
}

export function searchWiki(index: WikiSearchIndex, query: string, filters: WikiSearchFilters = {}): SearchResult[] {
  const normalizedQuery = normalizeWikiText(query);
  return index.documents.filter((document) => (
    (!normalizedQuery || document.searchableText.includes(normalizedQuery))
    && intersects([document.kind], filters.kinds)
    && intersects(document.element === null ? [] : [document.element], filters.elements)
    && intersects(document.path === null ? [] : [document.path], filters.paths)
    && intersects(document.rarity === null ? [] : [document.rarity], filters.rarities)
    && intersects(document.metrics, filters.metrics)
    && intersects([document.reviewStatus], filters.reviewStatuses)
  ));
}
