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
