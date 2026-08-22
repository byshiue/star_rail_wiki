# Task 9 report — Explainable deterministic recommendation agent

## Scope

Implemented a browser-local, rules-based recommendation engine and Agent recommendation page. The core does not call an LLM or require an API key. It pins every request to one release, enumerates stable logical-ID combinations, prunes illegal team structures before evaluator work, and calls `evaluateTeam()` once per scored candidate as the only authority for buff activation, values, evidence, unmet conditions, and wasted effects.

## Deterministic and auditable contract

- `RecommendationRequest` represents unrestricted or owned-only rosters, required/excluded characters, encounter mode and weaknesses, objective, archetype, investment limits, output limit, and combination budget.
- Enumeration sorts active character logical IDs, validates conflicts before work, requires damage and sustain coverage, checks `AbortSignal`, caps structural visits at 50,000, and caps expensive legal candidate evaluation at `maxCombinations`.
- Scoring returns all ten explicit components, their weighted contributions, total score, exported `SCORE_WEIGHTS`, and `weightsVersion: recommendation-weights-v1`.
- Buff applicability, activation cost, wasted effects, evidence IDs, and unmet conditions derive from `evaluateTeam()` output rather than a second buff implementation.
- Community matching contributes at most one normalized component and five weighted points; unavailable historical sources remain visible but contribute zero. Every contribution retains preset ID, HTTPS source URL, author, publisher, publication/retrieval metadata, availability, overlap, and bounded contribution. Community data is never consulted during legality checks.
- Ties use sorted team logical IDs. Results include single-slot substitutions with component and total-score deltas, global enumeration exclusions, truncation state, and deterministic explanations.
- The future `NaturalLanguageAdapter` accepts and returns typed deterministic structures but has no implementation or score/effect mutation authority.

## UI

`RecommendationPage` exposes UID input, owned-only roster input, required/excluded characters, objective, encounter, weakness, and archetype controls. It renders three candidates when the legal roster allows, score breakdowns, evaluator evidence IDs, unmet conditions, substitutions, source-attributed community references, enumeration exclusions, and pinned build links into the simulator. A null current release shows an honest empty state.

Task 10 can supply owned roster and investment data through the existing typed request/context inputs without changing the recommendation authority.

## TDD evidence

Initial RED command:

```text
npm test -- src/recommendations/recommendations.test.ts src/recommendations/RecommendationPage.test.tsx --maxWorkers=2
```

Result: exit 1. Both suites failed to resolve the intentionally missing `request` and `RecommendationPage` modules.

Focused GREEN command:

```text
npm test -- src/recommendations --maxWorkers=2
```

Result: 2 files and 10 tests passed. Coverage includes repeated-input determinism, input/bundle/preset permutation invariance, owned-only enforcement, structured insufficient-roster conflicts, bounded community prior, source attribution, substitutions and component deltas, cancellation, hard candidate budget, UI candidate audit output, simulator handoff, and honest constraint/empty states.

## Final verification

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test -- --maxWorkers=2`: 32 files and 208 tests passed.
- `npm run validate:data`: passed.
- `npm run build`: passed; TypeScript project build and Vite production build exited 0.

## Files

- `src/recommendations/{request,enumerateTeams,scoreTeam,recommendTeams,explainRecommendation}.ts`
- `src/recommendations/RecommendationPage.tsx`
- `src/recommendations/{recommendations,RecommendationPage}.test.tsx` (the core test is `.ts`)
- `src/styles/recommendations.css`
- `src/app/routes.tsx`
- `src/main.tsx`

No subagents were used, as required by the task assignment.

## Fix round 1 — reviewer findings

Addressed all eight findings from the initial review.

- Every candidate now builds and passes `validateTeamBuild()` before its sole `evaluateTeam()` call. Invalid equipment and investment constraints create deterministic candidate exclusions and do not stop unrelated candidates.
- Community priors reuse `validatePresetForBundle()` and additionally enforce owned, excluded, objective investment, eidolon, and light-cone constraints. Ineligible and unavailable sources contribute zero with retained reasons.
- Preset loading is a submission gate; release/load changes and failures clear old presets and candidates. Explicit null release completion now renders the honest no-release state.
- Recommendation cards show objective, encounter, explicit mixed roles, strengths, weaknesses, all ten applied weights, weighted values, buff metric/value/evidence/source revision, and substitution component deltas. Unavailable community URLs are plain text with publication and retrieval dates.
- Score weights are complete and versioned as `recommendation-weights-v2`; low-investment changes the applied activation-cost weight and actual configured eidolon/equipment/relic cost affects the component.
- Character revisions now carry required versioned `roles` metadata. Enumeration and scoring never infer roles from names, logical IDs, or paths. Import fixtures, public fixture data, and source checksums were synchronized.
- Added adversarial coverage for null completion, two-element and equipment permutation, invalid equipment isolation, investment exclusion, slow loading, reload failure clearing, unavailable source rendering, low-investment scoring, and mixed roles.

Verification after fixes:

- `npm test -- --maxWorkers=2`: 32 files, 214 tests passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run validate:data`: passed.
- `npm run build`: passed.
- Focused recommendation suite after final adversarial additions: 2 files, 15 tests passed.

## Fix round 2 — community assumptions, bounded preprocessing, and role provenance

Addressed every remaining and newly raised review finding.

- Community legality is prepared once at recommendation start. `validatePresetForBundle()` and request-level owned/excluded/investment checks run once per relevant preset; candidate scoring performs only overlap plus four-slot assumption checks. A 400-preset/multi-candidate regression records exactly 400 validator calls.
- Candidate assumptions are matched by character logical ID against the actual validated `TeamBuild`: eidolon, light-cone ID, superimposition, and the preset contract exclusion of relic/consumable fields. Any mismatch contributes zero and retains a reason.
- Community data is capped at 500 presets in both the Zod library schema and direct recommendation context. Preparation and candidate scans check `AbortSignal` every 32 presets.
- Removed project-invented `roles` from the upstream StarRailRes schema and restored the reviewed raw fixture checksums. `data/manual/character-roles.json` is now the versioned reviewed overlay; each record contains release, roles, review status, and immutable evidence provenance. Composition and repository validation require exactly one matching record for every active character, with missing/duplicate tests.
- Character bundles retain the complete `roleAnnotation`, and the bundle schema rejects annotation/release mismatches. Public and source fixtures were synchronized without broad formatting churn.
- All score components, including activation cost, are clamped to `[0,1]`. A maximum E6 + cone + relic input yields activation cost `1` and the UI percentage/weight interpretation remains consistent.
- Added true permutation coverage with at least two required and two excluded characters plus a seven-character owned roster, along with assumption mismatch, maximum investment, large community library, call-count, hard-limit, and cancellation regressions.

Final Fix R2 verification:

- `npm test -- --maxWorkers=2`: 32 files, 219 tests passed.
- Focused recommendations: 2 files, 20 tests passed.
- Game-data suite: 8 files, 76 tests passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm run validate:data`: passed.
- `npm run build`: passed.
- `git diff --check`: passed.

## Fix round 3 — authoritative validation, annotation identity, and real maximum-investment coverage

Addressed all three remaining review findings.

- Removed the replaceable community-preset validator from `RecommendationContext`. `prepareCommunityPresets()` always calls the authoritative `validatePresetForBundle()`; optional instrumentation only observes completed validations. The 400-preset regression verifies exactly 400 authoritative calls without exposing a bypass hook.
- Embedded `roleAnnotation.characterLogicalId` is retained in every character revision. `GameReleaseBundleSchema` rejects annotations whose embedded character ID differs from their owner, rejects non-reviewed annotations on active characters, and still enforces release identity. Typed schema and repository-copy tests cover swapped and generated/unreviewed annotations.
- Maximum investment is now exercised through the real `recommendTeams()` pipeline with a schema-valid bundle containing six eidolons per character, a legal S5 light cone, and a legal relic set. Core tests assert the component clamp at `1` and weighted value `-8`; the UI regression asserts `100%（权重 -8；加权 -8）`.
- `RecommendationPage` accepts typed `memberBuilds`, allowing account inventory/build data to affect recommendations without bypassing build validation or scoring authority.

Final Fix R3 verification:

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- Focused recommendations and UI: 2 files, 21 tests passed.
- Focused annotation schema/repository tests: 2 files, 67 tests passed.
- `npm test -- --maxWorkers=2`: 32 files, 223 tests passed.
- `npm run validate:data`: passed.
- `npm run build`: passed.
- `git diff --check`: passed.

The default unconstrained Vitest run initially timed out in two unrelated 5-second tests under host contention (221 passed). Both timed-out tests passed together with one worker (8/8), and the full suite passed with the repository's established two-worker verification command; no timeout masking or product-code workaround was added.

## Fix round 4 — mutation-safe recommendation instrumentation

Closed the remaining observer mutation boundary.

- `RecommendationInstrumentation.onCommunityPresetValidated` now receives only the primitive `presetId: string`; no callback can retain or mutate the internal `TeamPreset` used by precomputed community scoring.
- Added a TDD regression with an unavailable source and a malicious observer branch. The old implementation failed by exposing and mutating the complete preset object; the new implementation reports only the ID, preserves the source as unavailable, keeps its bounded contribution at zero, and retains the authoritative eligibility reason.
- The same suite continues to verify exactly one observer event per relevant preset (400 for preparation and 400 through recommendation), without making the observer authoritative.

Fix R4 verification:

- RED runtime: new regression failed because the observer received the complete `TeamPreset` object.
- RED typecheck: failed because the callback argument was not assignable to `string`.
- GREEN focused recommendations: 1 file, 16 tests passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test -- --maxWorkers=2`: 32 files, 224 tests passed.
- `npm run validate:data`: passed.
- `npm run build`: passed.
- `git diff --check`: passed.
