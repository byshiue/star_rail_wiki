import { useMemo, useState } from "react";
import type { GameReleaseBundle } from "../domain/releases";
import { buildSearchIndex, searchWiki, type WikiSearchFilters } from "./searchIndex";

export function useWikiSearch(bundle: GameReleaseBundle) {
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<WikiSearchFilters>({});
  const index = useMemo(() => buildSearchIndex(bundle), [bundle]);
  const results = useMemo(() => searchWiki(index, query, filters), [filters, index, query]);
  return { query, setQuery, filters, setFilters, results };
}
