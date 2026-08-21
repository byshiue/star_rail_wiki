# Task 6 report — Deterministic buff evaluator

## Scope

Implemented a UI-independent `evaluateTeam(build, scenario, bundle)` authority for simulator and recommendation consumers. The evaluator uses fractional internal values, returns deterministic classifications and aggregation, and retains evidence for every relevant included or excluded effect.

## Pipeline and contracts

- `context.ts`: public `TeamBuild`, `BattleScenario`, `TeamEvaluation`, result, warning, metric-group, and evidence contracts; pinned-release validation; selected character, eidolon, light-cone, and relic-set source legality.
- `conditions.ts`: deterministic condition ordering and operators, enemy break/weakness and set-piece resolution, trigger checks, finite duration state, and fresh-trigger refresh semantics.
- `targets.ts`: self, team, single ally/enemy, and all-enemy resolution plus selected-character consumer compatibility.
- `scaling.ts`: base/scaling-rank resolution, additive stack multiplication, stack caps, and explicit cap/rank warnings.
- `aggregate.ts`: reducers per metric and operation. Flat/percent values add, multiplier values compose multiplicatively, and overrides select the highest value deterministically while warning on conflicts. Unlike operations and unlike target sets never receive one misleading total.
- `evaluateTeam.ts`: one ordered classification path for reviewed active, satisfied conditional, inactive, unsupported/unreviewed, and wasted effects. Only active and currently satisfied conditional effects feed aggregation.

Evidence preserves the effect ID, source revision/logical IDs, release ID, source review status, source provenance records, stable provenance IDs, and original effect text. Results and warnings are sorted independently of bundle/condition input order, and inputs are not mutated.

## TDD evidence

### RED 1 — missing evaluator

Command:

```text
npm test -- src/effects/evaluateTeam.test.ts
```

Result: exit 1. Vitest failed to resolve the missing `./evaluateTeam` module, proving the initial golden boundary was absent.

### GREEN 1

The initial focused suite passed 6/6 tests after the minimum legality, condition, target, scaling, stacking, evidence, and aggregation pipeline was implemented. TypeScript type checking also passed.

### RED 2 — duration refresh and operation boundaries

The expanded focused suite failed 2/10 tests. One real evaluator defect treated a freshly matched event as expired when the prior finite duration was zero. The other failure was an overly exact assertion for normal IEEE-754 multiplier composition (`0.7999999999999998` versus `0.8`).

The evaluator now gives a fresh non-`always` trigger precedence over expired prior duration. The multiplier assertion uses numerical tolerance without adding evaluator-side rounding.

### GREEN 2

Command:

```text
npm test -- src/effects/evaluateTeam.test.ts && npm run typecheck
```

Result: exit 0; 10/10 evaluator tests and type checking passed.

## Coverage

Golden and invariant tests cover distinct damage bonus/vulnerability metrics, inactive condition evidence, unmet triggers, generated/unsupported review statuses, additive stack caps, input immutability, deterministic output, condition-order equivalence, zero/negative values, fresh trigger duration refresh, multiplier/override operation separation, conflicting overrides, metric caps, unresolved targets, and effects with no compatible consumer.

## Final verification

- `npm test -- src/effects`: exit 0; 1 file and 10 tests passed.
- `npm run check`: exit 0; typecheck and lint passed, 23 files and 132 tests passed, repository data validation passed, and the Vite production build completed with 121 modules transformed.

## Files

- `src/effects/{context,conditions,targets,scaling,aggregate,evaluateTeam}.ts`
- `src/effects/evaluateTeam.test.ts`
- `src/effects/__fixtures__/goldenTeams.ts`

## Residual constraints
- Single-target effects require an explicit scenario target assignment; they are retained as inactive with `target_required` otherwise.
- Effects whose source or normalized effect is not `reviewed` never enter aggregation.
- Unselected characters' sources are outside the relevant evaluation set; selected but locked/illegal sources remain explainable inactive entries.
- The task explicitly prohibited subagents, so the code-review skill's reviewer dispatch was not performed. A local complete-diff self-review and the full project verification were used instead.

## Fix Round 1

### Findings and root causes

The review identified six related authority-boundary defects:

1. Logical-ID `.find()` selected whichever character, light-cone, or relic revision appeared first instead of the unique active revision in the pinned bundle.
2. `Map<sourceRevisionId, source>` collapsed identical equipment selected in multiple member slots into one owner.
3. Metric-only aggregation exposed operation totals across incompatible concrete targets.
4. Trigger state and a trigger fired during the current evaluation were conflated, allowing expired effects to reactivate ambiguously.
5. Evidence omitted effect review status and review exclusions did not distinguish effect/source generated/unsupported states.
6. Unknown build references and invalid eidolon/rank values were silently skipped or accepted.

### TDD evidence

The initial Fix Round 1 command was:

```text
npm test -- src/effects/evaluateTeam.fix.test.ts
```

Result: exit 1; all 11 tests failed. The failures reproduced revision-order dependence, old equipment revisions winning, source-owner overwrite, the old metric-record aggregation API, missing explicit fresh trigger support, generic review reasons, and all five malformed-build cases being silently accepted.

After the primary implementation, 10/11 tests passed. The remaining failure was a deliberately exact IEEE-754 expectation for a multiplier value; it was corrected to a tolerance assertion without evaluator-side rounding.

A follow-up RED proved that a finite-duration effect with only historical `activeEvents` was still active without a fresh trigger or positive remaining duration. The condition pipeline was tightened and the complete evaluator suite returned to green.

### Implementation

- Character, light-cone, and relic selection now groups by kind/logical ID and requires exactly one `validToReleaseId === null` revision for the pinned bundle, independent of array order.
- Sources are instantiated as deterministic `slotId:sourceRevisionId` records. Evaluation IDs, evidence IDs, self targets, target assignments, remaining duration, and stacks can all distinguish member-slot instances.
- `TeamEvaluation.groups` is now a deterministic `AggregationGroup[]`. Every group represents exactly one metric, operation, and sorted concrete target signature; no cross-target or cross-operation pseudo-total is exposed.
- Explicit stacking rules are applied after target grouping. Non-additive duplicate team effects contribute once, while additive instances respect the shared stack cap; self effects remain separate per target.
- `BattleScenario.firedThisEvaluation` records battle-start, action, and event triggers fired in the current snapshot. A fresh trigger may start/refresh an expired effect; historical state alone cannot activate finite or instant effects.
- Evidence now includes `effectReviewStatus` and `sourceReviewStatus`. Exclusions distinguish `effect_not_reviewed`, `source_not_reviewed`, `unsupported_effect`, and `unsupported_source`.
- `TeamBuildValidationError` provides deterministically ordered structured issues. Evaluation fails before computing targets for unknown/ambiguous revisions, invalid member counts/slots, eidolons, superimposition ranks, relic references/piece counts, and effect levels.

### Regression coverage

Fix tests cover shuffled historical/current character, light-cone, and relic revisions; two member slots sharing one light cone; instance-specific stacks and self ownership; target-scoped aggregation API; expired event and battle-start effects; explicit fresh triggers; all four effect/source review-state reasons; unknown character/equipment; invalid eidolon/rank; and structured issue ordering.

### Final verification

- `npm test -- src/effects`: 2 files and 22 tests passed.
- `npm run typecheck` and `npm run lint`: passed.
- Full Vitest run: 24 files and 144 tests passed.
- `npm run validate:data && npm run build`: passed; Vite transformed 121 modules.

The task prohibited subagents, so Fix Round 1 used local full-diff review plus the complete project checks.

## Fix Round 2

### Finding and root cause

Additive stack caps were applied twice: scaling capped each source instance and could warn only when that individual instance exceeded the cap, while target-scoped aggregation silently truncated the combined stacks from multiple source instances. Two instances requesting two stacks each against a shared cap of three therefore produced the correct total but no explanation for the discarded stack.

### TDD evidence

Added a regression with two source instances each requesting two stacks against cap three, plus the same evaluation with reversed member and effect input order.

Initial focused command:

```text
npm test -- src/effects/evaluateTeam.fix.test.ts
```

Result: exit 1; 1 of 13 tests failed because the shared-cap warning collection was empty even though the aggregate total was truncated to 30.

After implementation, the focused suite passed 13/13 and all evaluator tests passed 23/23.

### Implementation

- Scaling now retains both applied `stacks` and normalized `requestedStacks`; it no longer emits instance-local additive cap warnings.
- Target-scoped aggregation groups source instances by stable effect ID, applies the shared cap once, and emits exactly one `stack_cap_exceeded` warning per affected effect/target group.
- The warning includes `effectId`, sorted participating `evaluationIds`, `requestedStacks`, `stackCap`, `discardedStacks`, and a stable explanatory message.
- Effect groups and participating instances are sorted before warning construction, so reversing source/effect input order yields identical warnings.

### Final verification

- `npm test -- src/effects`: 2 files and 23 tests passed.
- `npm run check`: passed; typecheck, lint, 24 files/145 tests, repository validation, and production build all succeeded. Vite transformed 121 modules.
