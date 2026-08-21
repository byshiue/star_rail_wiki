# Task 8 report — Sourced community team library

## Scope

Implemented a checked-in, normalized community team library with runtime schemas, source validation, repository integration, version-aware browsing, and a validated handoff into the existing simulator.

## Data and provenance contract

- `TeamPresetSchema` now requires a release ID, game version, fixture/released channel, exactly four character logical IDs, documented substitution slots, investment assumptions, archetype tags, and a project-authored summary.
- Every source requires an HTTPS URL, bounded provenance text, retrieval timestamp, availability, and either a valid publication timestamp or an explicit unknown reason.
- `CommunityTeamLibrarySchema` rejects duplicate preset IDs, distinguishes fixture-only libraries explicitly, and refuses to select fixture data as current.
- The checked-in representative preset is explicitly synthetic, uses an HTTPS example source, has `channel: fixture`, and keeps `currentReleaseId: null`. It proves normalization, exact-bundle validation, and handoff without masquerading as a production recommendation.
- Real current community sources and released logical IDs remain the audited Task 12 data responsibility.

## Repository and simulator boundaries

- `loadCommunityTeams(releaseId)` and `loadCommunityTeamLibrary()` fetch the published artifact, runtime-parse it, and return deterministically sorted normalized clones.
- `createTeamBuildFromPreset()` validates the exact release/channel/source/entity composition and preserves investment, requirements, substitutions, and explicit character/equipment assumptions in the share payload.
- `validateCommunityRepository()` composes the community library with the release index and exact parsed bundles, rejecting orphan releases, mismatched versions/channels, inactive entities, and invalid equipment references as part of `npm run validate:data`.
- Existing temporary repository fixtures were extended with the new required community file so their release/coverage failure tests continue to isolate one invalid variable.

## UI

- `/community` is now a real `ReleaseProvider` route.
- Native controls filter by exact release ID (displaying game version), archetype tag, included primary/substitute logical ID, and investment assumption.
- Cards preserve source attribution and retrieval metadata; unavailable sources render no active link.
- Presets with release/channel/source/entity validation failures show stale/unavailable state and cannot be loaded.
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

- Focused community/schema/route tests: 4 files, 31 tests passed.
- TypeScript typecheck: passed.
- ESLint: passed.
- Repository data validation: passed.
- Vite production build: passed with 140 modules transformed.
- Full low-concurrency Vitest run: 30 files, 192 tests passed with `--maxWorkers=2`.
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
- The representative fixture is checked against its exact fixture bundle and completes a real simulator handoff; it is never treated as released/current data.
- Task instructions prohibited subagents, so the mandatory review step used a complete local diff self-review instead of dispatch.
- The environment's patch helper repeatedly failed with `bwrap: pivot_root`; after confirming the fault, edits were applied as non-destructive `git apply` patches and independently verified.

## Fix Round 1

All seven review findings were addressed:

1. Repository validation now composes the community artifact with the release index and exact bundles; the checked fixture contains real active fixture entities and passes handoff.
2. Source URLs are HTTPS-only, and unavailable sources never render an active anchor.
3. Structured preset metadata and explicit eidolon/equipment assumptions survive encode/decode and are displayed by the simulator.
4. Logical IDs and user-facing strings are trimmed and bounded; duplicate primaries/substitutes, primary-as-substitute, invalid slot indices, and oversized collections are rejected.
5. Publication provenance requires a valid timestamp or an explicit unknown reason.
6. Repository ordering and diagnostic ordering are deterministic, while stale state combines release, channel, source availability, and entity validation.
7. Route integration exercises the fetch-backed repository through provider remount/reload and real simulator decode/handoff, including malformed, unavailable, loading, error, empty, fixture, duplicate, orphan, and determinism paths.

### Fix Round 1 TDD evidence

- Initial focused RED: 25 tests, 24 failed and 1 passed.
- Focused GREEN before final verification: 4 files, 31 tests passed.
- Direct checked-fixture handoff assertion: 19 tests passed in the composition suite.

## Fix Round 2

All four follow-up findings were addressed:

1. Repository composition, UI loadability, and handoff now share the authoritative `validateTeamBuild()` legality path. Exact-bundle validation rejects path-incompatible light cones, actual character eidolon limits, superimposition limits, unknown/ambiguous revisions, and every other handoff failure before navigation.
2. The synthetic fixture no longer claims a reachable public source: its HTTPS `.invalid` URL is explicitly `unavailable`, the UI renders no anchor, and source availability is kept separate from internal fixture build legality so exact-bundle handoff remains testable.
3. HTTPS validation guards URL construction, so `safeParse()` returns a normal Zod failure for malformed, JavaScript, FTP, and HTTP inputs without throwing.
4. Community share metadata now includes primary slots and is checked against all members, eidolons, equipment, slot IDs, and unmodeled relic/consumable edits. Any simulator member/eidolon/equipment/relic edit clears `communityPreset`, and the regenerated share URL no longer claims the original assumptions.

### Fix Round 2 TDD and verification evidence

- Initial focused RED: 2 files, 31 tests; 9 failed and 22 passed.
- Focused GREEN: 2 files, 31 tests passed.
- TypeScript typecheck, ESLint, repository data validation, and Vite production build passed.
- Full low-concurrency Vitest run: 30 files, 198 tests passed with `--maxWorkers=2`.
