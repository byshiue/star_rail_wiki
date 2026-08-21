import { useMemo, useState } from "react";
import type { GameReleaseBundle } from "../domain/releases";
import { buildSearchIndex, searchWiki, type WikiSearchFilters } from "./searchIndex";

export function useWikiSearch(bundle: GameReleaseBundle) {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<WikiSearchFilters>({});
  const indexState = useMemo(() => {
    try {
      return { index: buildSearchIndex(bundle), error: null };
    } catch (error: unknown) {
      return {
        index: null,
        error: error instanceof Error ? error.message : "资料索引构建失败",
      };
    }
  }, [bundle]);
  const results = useMemo(() => indexState.index === null
    ? []
    : searchWiki(indexState.index, query, filters), [filters, indexState.index, query]);
  return { query, setQuery, filters, setFilters, results, error: indexState.error };
}
