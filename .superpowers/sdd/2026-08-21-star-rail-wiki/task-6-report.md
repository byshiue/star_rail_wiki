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
