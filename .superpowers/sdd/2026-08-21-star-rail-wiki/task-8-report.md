# Task 8 report — Sourced community team library

## Scope

Implemented a checked-in, normalized community team library with runtime schemas, source validation, repository integration, version-aware browsing, and a validated handoff into the existing simulator.

## Data and provenance contract

- `TeamPresetSchema` now requires a release ID, game version, fixture/released channel, exactly four character logical IDs, documented substitution slots, investment assumptions, archetype tags, and a project-authored summary.
- Every source records its exact URL, title, author, publisher, nullable publication date, retrieval timestamp, and current availability. A nullable publication date is permitted because the retrieval timestamp always supplies the required access date.
- `CommunityTeamLibrarySchema` rejects duplicate preset IDs and refuses to select fixture data as current.
- The checked-in representative preset is explicitly synthetic, uses an `.invalid` source, has `channel: fixture`, and keeps `currentReleaseId: null`. It proves normalization and validation without masquerading as a production recommendation.
- Real current community sources and released logical IDs remain the audited Task 12 data responsibility.

## Repository and simulator boundaries

- `loadCommunityTeams(releaseId)` returns validated normalized clones scoped to one exact release ID; `loadCommunityTeamLibrary()` supports historical browsing.
- `createTeamBuildFromPreset()` converts only stable character logical IDs, pins the preset release, and delegates release/ID/duplicate validation to the simulator's existing `validateTeamBuild()` authority before any navigation.
- `validateCommunitySources()` emits structured `missing_provenance` and `invalid_preset` issues. The repository validator now parses the community library and source contract as part of `npm run validate:data`.
- Existing temporary repository fixtures were extended with the new required community file so their release/coverage failure tests continue to isolate one invalid variable.

## UI

- `/community` is now a real `ReleaseProvider` route.
- Native controls filter by exact release ID (displaying game version), archetype tag, included primary/substitute logical ID, and investment assumption.
- Cards preserve source attribution and retrieval metadata even when a source is unavailable.
- Presets from another release show an explicit stale warning and cannot be loaded.
- Current-release presets are converted, validated, encoded, and navigated to `/simulator`; malformed release or logical IDs surface as an accessible alert.
- A null production current release renders an honest empty state and never loads the checked-in fixture preset.

## TDD evidence

### Initial RED

```text
npm test -- scripts/validate-community-teams.test.ts src/community/community.test.tsx
```

Result: exit 1 because the community data file, validator, repository, and page did not exist.

### GREEN

```text
npm test -- scripts/validate-community-teams.test.ts src/community/community.test.tsx
```

Result: 2 files and 6 tests passed.

An additional release-filter regression first failed because the UI used display `gameVersion` values. After changing the filter key to exact `releaseId`, the focused community suite passed all 3 tests.

## Full-suite regression investigation

The first low-concurrency full run passed 27 suites but failed two existing temporary-repository tests. Both failures were `ENOENT` for the newly required `data/community/teams.json`, masking each fixture's intended release/coverage error. Adding the community file to those otherwise-complete temporary repositories restored their single-variable contract; `scripts/game-data/effects.test.ts` then passed all 44 tests.

## Final verification

- Focused community/schema/route tests: 4 files, 28 tests passed.
- TypeScript typecheck: passed.
- ESLint: passed.
- Repository data validation: passed.
- Vite production build: passed with 141 modules transformed.
- Full low-concurrency Vitest run: 28 files, 167 tests passed with `--maxWorkers=2`.
- `git diff --check`: passed.

## Files

- `data/community/teams.json`
- `src/domain/community.ts`
- `src/community/{teamRepository,CommunityTeamsPage,community.test}.ts(x)`
- `scripts/{validate-community-teams,validate-community-teams.test,validate-repository}.ts`
- `src/app/routes.tsx`
- `src/main.tsx`
- `src/styles/community.css`
- `scripts/game-data/effects.test.ts`

## Residual constraints

- The repository intentionally has no production current release or community recommendation; the route therefore shows the honest empty state by default.
- The representative fixture demonstrates the pipeline only and cannot pass simulator ID validation against a released bundle.
- Task instructions prohibited subagents, so the mandatory review step used a complete local diff self-review instead of dispatch.
- The environment's patch helper repeatedly failed with `bwrap: pivot_root`; after confirming the fault, edits were applied as non-destructive `git apply` patches and independently verified.
