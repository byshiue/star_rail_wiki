# Task 7 report — Character builder and team simulator UI

## Scope

Implemented released-bundle-injectable character-builder and team-simulator pages on top of Task 6's `evaluateTeam()` authority. The UI owns validated build/scenario state and presentation only; it does not reproduce evaluator arithmetic.

## Build and URL contracts

- `teamBuild.ts` uses strict Zod schemas for release IDs, stable logical IDs, investments, relic selections, and domain metrics.
- Share payloads are deterministic URI-safe JSON. Display names and revision IDs are neither accepted nor encoded.
- Decode rejects malformed, stale-release, unknown logical-ID, extra revision-field, invalid range, duplicate-character, duplicate-slot, and incompatible-path builds before evaluation.
- Recoverable link failures render an accessible alert and a clear/rebuild action rather than throwing through the route.
- A null current release renders an honest empty state. Tests inject a synthetic released bundle without changing repository current-release policy.

## UI

- Up to four keyboard-operable team slots expose character, eidolon, compatible light-cone, superimposition, relic-set, and set-piece controls. The character-builder route reuses the same state path with one slot.
- Native scenario controls cover enemy break, battle/action state, fresh events, enemy weaknesses, and typed custom conditions.
- Responsive desktop layout places the pinned release/team configuration beside categorized results and stacks them on narrow screens.
- Results disclose `active`, `conditional`, `inactive`, `unsupported`, and `wasted` entries by target/metric plus evaluator warnings.
- Every entry opens a keyboard-dismissible, initially focused evidence dialog and restores focus to its opener. Evidence includes effect ID, revision/logical IDs, review state, original text, provenance, release, and source links.

## TDD evidence

### RED

Command:

```text
npm test -- src/simulator/simulator.test.tsx
```

Result: exit 1 because `TeamSimulatorPage` did not exist. This established the missing interaction boundary before production implementation.

### GREEN

Focused verification after implementation:

```text
npm test -- src/simulator
npm run build
```

Result: exit 0; 1 simulator test file and 5 tests passed, and the production build completed.

Tests cover stable logical-ID round trips, rejection of revision fields, duplicate/incompatible build validation, eidolon-driven recomputation, released provenance and source links, dialog focus/escape restoration, malformed and stale hash recovery, and the null-current-release empty state.

## Final verification

`npm run check`: exit 0.

- TypeScript type checking passed.
- ESLint passed.
- Vitest passed 25 files and 150 tests.
- Repository data validation passed.
- Vite production build passed with 136 modules transformed.

## Files

- `src/simulator/{teamBuild,useTeamBuild,CharacterBuilderPage,TeamSimulatorPage,TeamSlots,ScenarioControls,EffectSummary,EvidenceDrawer}.ts(x)`
- `src/simulator/simulator.test.tsx`
- `src/styles/simulator.css`
- `src/app/routes.tsx`
- `src/main.tsx`
- `src/effects/context.ts` (adds UI validation issue codes)

## Residual constraints

- Share links intentionally encode build investments, not mutable display labels, revision IDs, or scenario snapshots.
- The checked-in repository still has `currentReleaseId: null`; real released data remains Task 12's audited responsibility.
- The task prohibited subagents, so validation used a local complete-diff self-review and the full repository gate.

## Fix Round 1

### Review findings addressed

- Rendered evaluator-owned aggregation groups by concrete target, metric, and operation, including post-stacking applied values, final capped totals, configured caps, and warnings.
- Made the build query parameter bidirectionally synchronized with UI state across valid, malformed, stale, back/forward, recovery, and last-member-clear transitions without update loops.
- Enforced the single-member `/builds` contract at validation/evaluation boundaries; multi-member shares now show a recoverable error and never evaluate hidden members.
- Split persistent scenario conditions from one-shot battle-start, action, and event triggers, with explicit replay controls.
- Exposed all three supported relic-set selections and their piece counts, preserving shared-build values and preventing duplicate hidden selections.
- Added complete Tab/Shift+Tab containment to the evidence dialog while preserving Escape close and opener focus restoration.
- Added accessible loading/error coverage; the existing suite continues to cover the empty-release state.

### TDD evidence

RED: `npm test -- src/simulator/simulator.fix.test.tsx` initially ran seven regressions; six failed against the pre-fix UI and the existing loading/error behavior passed.

GREEN: `npm test -- src/effects src/simulator` passed four files and 35 tests after implementation. The focused simulator suite passed two files and 12 tests, including normal last-member URL removal.

### Final verification

`npm run check`: exit 0.

- TypeScript type checking and ESLint passed.
- Vitest passed 26 files and 157 tests.
- Repository data validation passed.
- Vite production build passed with 136 modules transformed.

## Fix Round 2

### Review findings addressed

- Relic-set controls now enforce contiguous selection: slots two and three remain disabled until the preceding slot is populated, and update handlers compact and guard arrays before state writes.
- Build encoding is performed once through the strict schema inside a non-throwing memoized boundary. Invalid UI state suppresses URL/share rendering and becomes an accessible build alert instead of throwing the route.
- Fresh battle-start, action, and event markers are now call-local inputs to a single evaluator invocation. The resulting evaluation snapshot remains inspectable, while no `firedThisEvaluation` value is persisted. Character, eidolon, equipment, relic, persistent-scenario, and external URL/history changes clear the snapshot.
- Aggregation values now follow operation semantics: flat values are numeric regardless of metric, percent values use percentages, multipliers render as factors, and overrides render as replacement values.

### TDD evidence

RED: the expanded `simulator.fix.test.tsx` ran 11 regressions; four new tests failed for enabled sparse relic slots, reused one-shot state across build changes, reused one-shot state across URL navigation, and metric-guessed flat formatting.

GREEN:

- `npm test -- src/simulator/simulator.fix.test.tsx`: 11 tests passed.
- `npm test -- src/simulator src/effects`: four files and 39 tests passed.
- Cross-unit coverage includes flat attack/HP/defense/healing/shielding, percent speed, multiplicative factors, and override replacement values.

### Final verification

- TypeScript type checking and ESLint passed.
- `npm run check` was attempted twice. Both runs passed typecheck/lint and 160 of 161 tests, but the unchanged `scripts/game-data/cli-fetch.test.ts` child-process test hit its fixed 5-second timeout under full parallel load.
- The timed-out CLI test passed alone in 481 ms (two tests passed), confirming parallel resource contention rather than a Task 7 regression.
- `npm test -- --maxWorkers=2` passed all 26 files and 161 tests; repository data validation and the Vite production build also passed with 136 modules transformed.
