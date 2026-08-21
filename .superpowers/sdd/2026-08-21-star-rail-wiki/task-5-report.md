# Task 5 Report: Searchable Wiki and version/source details

## Status

DONE

Implementation commits:

- `dcf47f1` — `feat: add versioned searchable wiki`
- `a324e80` — `fix: disclose all character revisions`

Baseline: `fab758095e2eba783cb2a212244f1914f3357490`.

## Implemented

- Added `ReleaseProvider`, consuming `loadReleaseIndex()` and `loadRelease()` without redefining release or entity types.
- Added normalized full-text indexing for character/equipment names, descriptions, feature text, effect text, element, path, rarity, effect metrics, and reviewed status. Simplified-Chinese punctuation and whitespace are normalized only in the index; displayed source text remains unchanged.
- Added character, light-cone, and relic-set browsing with an accessible searchbox and type filter, keyboard-operable result links, hash-router-compatible detail routes, visible focus styling, touch-sized controls, and responsive mobile layout.
- Added complete character skills, traces, eidolons, light-cone superimposition values, relic set thresholds, normalized effects/buffs, review status, validity range, upstream URL/path/revision, and per-revision change links.
- Added historical top-level character and equipment revision disclosure. When peer revisions exist, the before/after link pins the comparison revision in the query while the page displays both revisions and their provenance.
- Preserved the production truth: `currentReleaseId: null` renders `尚未导入正式版本`. The 4.3 synthetic bundle is reachable only through explicit test injection and is labeled `测试夹具 4.3`, never `正式服` or current.

## TDD evidence

### RED 1 — missing Wiki boundary

Command:

```text
npm test -- src/wiki/wiki.test.tsx
```

Result: exit 1. Vitest failed to resolve missing `./EntityDetailPage`; one suite failed and zero tests were collected. This was the expected missing-feature boundary before production code existed.

### GREEN 1 — search, detail, provenance, keyboard, empty production state

Command:

```text
npm test -- src/wiki/wiki.test.tsx
```

Result: exit 0; one file and four tests passed. The cycle also exposed and fixed floating-point superimposition display (`14.000000000000002%` to `14%`).

### RED/GREEN 2 — every equipment revision

The first draft history assertion passed immediately and was rejected as inadequate. After strengthening it to require both old and current descriptions and source paths, `npm test -- src/wiki/revisionHistory.test.tsx` exited 1 because only one revision rendered. After the minimal per-revision rendering change, the equipment history and main Wiki suites passed.

### RED/GREEN 3 — every character revision

`npm test -- src/wiki/characterRevisionHistory.test.tsx` exited 1 because only the first character revision rendered. The minimal fix renders each character revision with its own features, effects, provenance, validity, and unique accessible section IDs. The three focused Wiki files then passed: three files, six tests.

## Final verification

Fresh command after all production and test changes:

```text
npm run check
```

Result: exit 0.

- TypeScript: passed.
- ESLint: passed.
- Vitest: 14 files, 110 tests passed.
- Repository data validation: passed.
- Vite production build: passed; 117 modules transformed.
- `git diff --check`: passed.

## Files

- `src/app/ReleaseProvider.tsx`
- `src/app/routes.tsx`
- `src/main.tsx`
- `src/styles/wiki.css`
- `src/wiki/EffectSourceList.tsx`
- `src/wiki/EntityDetailPage.tsx`
- `src/wiki/VersionBadge.tsx`
- `src/wiki/WikiPage.tsx`
- `src/wiki/searchIndex.ts`
- `src/wiki/useWikiSearch.ts`
- `src/wiki/wiki.test.tsx`
- `src/wiki/revisionHistory.test.tsx`
- `src/wiki/characterRevisionHistory.test.tsx`

## Risks and notes

- The checked-in 4.3 payload remains synthetic fixture data. Production stays intentionally empty until a reviewed released-channel snapshot is imported by the later data-audit task.
- Search filters support kind, element, path, rarity, effect metric, and review status at the pure API boundary; the current UI exposes the type selector while full text covers the other indexed dimensions. Additional visible facets can be added when real released data provides meaningful option sets.
- The comparison query identifies the peer revision and both revisions are rendered together; a field-level visual diff is not recomputed in the browser because Task 5 consumes repository/domain data and does not duplicate the Task 3 diff algorithm.
- The task prohibited subagents, so the normally requested delegated code review was replaced by a full local diff audit and fresh complete verification.
