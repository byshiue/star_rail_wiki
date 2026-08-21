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

## Fix Round 1

Status: DONE

Commit: `3a04d85` (`fix: complete wiki revision disclosure`).

### Review findings resolved

1. Structured effect disclosure now renders trigger, duration, stacking, conditions, and dispellable state. `unsupported` effects are excluded from “可用效果” and shown in a separate “不支持解析，仅展示原文” section.
2. Compare links now encode both the selected revision and its immediate predecessor from the release chain. The route parses those parameters, rejects non-adjacent pairs, and renders a stable before/after field table. A three-revision test proves 4.3 compares to 4.2, not 4.1.
3. Every top-level and nested revision badge resolves its own `validFromReleaseId` through `ReleaseProvider.index.releases`. Missing metadata is disclosed instead of borrowing the bundle release. A 4.1→4.2→4.3 fixture-chain test covers cross-version labels.
4. Direct detail routes now consume provider loading and error states, rendering a status while loading and an alert on failure.
5. Search documents are aggregated by entity kind plus logical ID. All historical revision text and metrics remain searchable while the UI receives one result and one key per logical entity.
6. A real `App`/`HashRouter` integration test exercises the production repository boundary through `loadReleaseIndex()` and `loadRelease()`. Its in-memory non-fixture released payload covers complete skill/trace/eidolon content, complex and unsupported effects, relic thresholds, released labeling, detail navigation, and load failure. No checked-in fixture was promoted or relabeled.

### TDD evidence

- Effect RED: the focused test showed complex event/turn/additive/condition/dispellable fields were absent and unsupported text appeared in “可用效果”. GREEN: `src/wiki/effectDisclosure.test.tsx` passed.
- Search RED: two revisions of one light cone produced two documents. GREEN: `src/wiki/searchHistory.test.ts` passed with one result that remained searchable by historical-only text.
- Revision/compare RED: all three historical revisions displayed the bundle’s 4.3 badge and the old link produced no comparison content. GREEN: `src/wiki/revisionCompare.test.tsx` passed with distinct 4.1/4.2/4.3 badges and an adjacent 4.2→4.3 before/after table.
- Integration coverage: `src/wiki/appIntegration.test.tsx` passed both the deferred released-load success flow and direct-route network failure flow.
- Focused combined verification: `npm test -- src/wiki` passed 7 files and 11 tests; `npm run typecheck` passed.

### Final verification

Fresh command after all Fix Round 1 changes:

```text
npm run check
```

Result: exit 0.

- TypeScript and ESLint passed.
- Vitest passed 18 files and 115 tests.
- Repository data validation passed.
- Vite production build passed with 120 modules transformed.
- `git diff --check` and staged `git diff --cached --check` passed.

### Residual notes

- The browser diff is intentionally a stable presentation-only recursive field comparison for adjacent revisions; it excludes identity, validity, and provenance bookkeeping fields. The Task 3 release diff remains the import/build authority.
- The checked-in 4.3 fixture remains synthetic and `currentReleaseId` remains `null`; the released integration payload exists only inside the test.
- Subagent review was not run because this task explicitly prohibited subagents. Local staged-diff review and complete verification were used instead.

## Fix Round 2

Status: DONE

Commit: `dab0c8a` (`fix: stabilize wiki history comparisons`).

### Review findings resolved

1. Search aggregation now selects the single active revision (`validToReleaseId === null`) as the canonical visible result, independent of input order. Historical revisions contribute only searchable text and metrics. Missing or ambiguous active revisions are rejected safely instead of silently choosing an arbitrary record.
2. Revision comparison now recursively compares nested objects and arrays. Arrays with stable identities are aligned by `logicalId` or `id`; other arrays use deterministic index alignment. Identity, validity, provenance, and checksum bookkeeping fields are excluded at every nesting level.
3. Character abilities, traces, and eidolons are no longer emitted as whole-array JSON cells. Meaningful nested changes render as readable leaf paths such as `abilities[ability:synthetic-support-skill].originalText`.
4. The comparison table now has a keyboard-focusable, horizontally scrollable region and defensive wrapping for narrow screens.

### TDD evidence

- Search RED: shuffled revisions selected historical display content, and malformed zero-active/two-active histories were accepted. GREEN: the canonical active revision supplies display fields while historical-only text remains searchable; malformed histories throw a clear canonical-revision error.
- Nested-diff RED: a localized ability text change emitted the complete `abilities` array as JSON. GREEN: it emits one leaf change and leaks no identity, validity, provenance, or checksum bookkeeping fields.
- Focused verification: `npm test -- src/wiki` passed 9 files and 15 tests; `npm run typecheck` and `npm run lint` passed.

### Final verification

Fresh command after all Fix Round 2 changes:

```text
npm run check
```

Result: exit 0.

- TypeScript and ESLint passed.
- Vitest passed 20 files and 119 tests.
- Repository data validation passed.
- Vite production build passed with 121 modules transformed.
- `git diff --check` and staged `git diff --cached --check` passed.

### Residual notes

- Invalid revision sets with anything other than exactly one active revision are intentionally rejected rather than guessed.
- Arrays without unique stable identities fall back to index alignment; repository-owned stable IDs remain the preferred comparison contract.
- Subagent review was not run because this task explicitly prohibited subagents. Local staged-diff review and complete verification were used instead.

## Fix Round 3

Status: DONE

Commit: `bb01681` (`fix: enforce wiki canonical integrity`).

### Review finding resolved

1. Equipment search aggregation now groups by `kind + logicalId`, so a light cone and relic set with the same logical ID remain distinct canonical documents.
2. `GameReleaseBundleSchema` now enforces exactly one active revision for every `kind + logicalId` group across characters, equipment, and nested features. Repository loads therefore reject invalid canonical sets at the data boundary.
3. The Wiki remains defensive when an invalid in-memory bundle bypasses repository parsing: search-index construction errors are caught and rendered as an accessible `role="alert"` instead of escaping React render.
4. The existing comparison scroll region already provides `tabIndex={0}`, `role="region"`, and an accessible name. No passing-before-change test was added solely to restate that existing behavior.

### TDD evidence

- Search grouping RED: two active equipment revisions with the same logical ID but different kinds collided and threw a two-active canonical error. GREEN: both documents remain separate with their own kind and name.
- Repository RED: a fetched bundle containing two active revisions for one light-cone identity resolved successfully. GREEN: schema parsing rejects it with the canonical active-revision invariant.
- Wiki RED: rendering a real `WikiPage` with an injected invalid bundle threw from `buildSearchIndex`. GREEN: the page renders a named failure section and accessible alert, with no search controls.
- Initial focused RED: 3 files failed with 3 targeted failures; the other 7 tests passed.
- Focused GREEN after refactor: `npm test -- src/wiki src/data/releaseRepository.test.ts` passed 12 files and 25 tests; `npm run typecheck` and `npm run lint` passed.

### Final verification

Fresh command after all Fix Round 3 code and test changes:

```text
npm run check
```

Result: exit 0.

- TypeScript and ESLint passed.
- Vitest passed 22 files and 122 tests.
- Repository data validation passed.
- Vite production build passed with 121 modules transformed.
- `git diff --check` and staged `git diff --cached --check` passed.

### Residual notes

- The schema is the authority for repository-loaded bundles; the Wiki alert is a secondary defense for explicit/in-memory injection and future callers that bypass parsing.
- Subagent review was not run because this task explicitly prohibited subagents. Local diff review and complete verification were used instead.

## Fix Round 4

Status: DONE

Commit: `55aac8b` (`test: cover wiki integrity boundaries`).

### Test coverage added

1. The revision comparison UI test now selects the exact `region` named `版本变化明细`, asserts `tabindex="0"`, and verifies the comparison table is inside that focusable region.
2. The cross-kind same-logical-ID test now reparses the augmented entities through `GameReleaseBundleSchema` before calling `buildSearchIndex`, proving the schema and search boundaries accept and preserve distinct equipment kinds together.
3. No production code changed. These assertions cover behavior established in Fix Rounds 2 and 3.

### Verification

Focused command:

```text
npm test -- src/wiki/revisionCompare.test.tsx src/wiki/searchGrouping.test.ts
```

Result: exit 0; 2 files and 2 tests passed.

Fresh full command:

```text
npm run check
```

Result: exit 0.

- TypeScript and ESLint passed.
- Vitest passed 22 files and 122 tests.
- Repository data validation passed.
- Vite production build passed with 121 modules transformed.
- `git diff --check` and staged `git diff --cached --check` passed.
