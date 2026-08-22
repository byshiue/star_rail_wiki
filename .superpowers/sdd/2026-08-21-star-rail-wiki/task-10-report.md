# Task 10 report — Isolated multi-UID local profiles and JSON backup

## Scope

Implemented private browser-local account profiles keyed by an exact nine-digit UID. The production adapter uses IndexedDB through `idb`; tests inject a deterministic memory adapter. No profile workflow performs network writes or stores credentials.

## Data and transaction contract

- `ProfileDatabase` provides UID-keyed list/get/put/delete/update operations. IndexedDB schema version 1 stores profiles by UID and indexes `updatedAt`; the service exposes an explicit schema migration hook for legacy version 0 records.
- Every stored profile passes the runtime `AccountProfileSchema` plus current schema-version and inventory stable-ID uniqueness checks before a write.
- UID values remain strings and are never converted to JavaScript numbers.
- Import parses and validates the complete strict JSON document before opening its write transaction. Existing same-UID records require explicit `merge` or `replace`; invalid JSON, schema failure, version conflicts, and transaction errors do not partially mutate storage.
- Merge takes the greater character eidolon/level and light-cone superimposition/level, retains distinct relic instance IDs, and rejects cross-release merges. A different imported UID writes only its own key.
- Export is deterministic and sorted. The strict envelope carries `schemaVersion`, `releaseId`, `updatedAt`, and the approved profile payload; browser selection metadata is excluded.
- Deletion requires an exact repeated UID. Creating an already existing UID is rejected rather than silently replacing inventory.

## UI and recommendation integration

- `/profiles` now supports loading/error/empty states, creation, selection, display-name editing, character/eidolon/level inventory, light-cone/superimposition/level inventory, relic instances, deterministic JSON backup, explicit merge/replace import, and an exact-UID deletion dialog.
- A null current release is reported honestly while profiles remain locally creatable with explicit data-release provenance. When a loaded bundle does not match a profile release, existing stable IDs remain readable/savable but additions from the wrong release are disabled.
- The selected UID is browser-local and shared with the recommendation page. Selection or reload starts by clearing the previous UID's roster and investment data; request tokens prevent stale asynchronous loads from writing back after a newer selection.
- Task 9 receives owned-only character IDs, actual eidolons, allowed light-cone/relic IDs, and deterministic stable-ID equipment allocation. Compatible owned light cones are assigned once with their real superimposition; relic instances are grouped by set and assigned deterministically. The UI discloses this allocation rule, and the simulator link regression proves the selected S4 cone reaches the candidate build.
- Profile styles use project tokens, hide live-region text accessibly, and collapse to one column for a 320px viewport under the 720px breakpoint.

## TDD and review evidence

Initial RED failed because all profile modules were absent. Subsequent RED cases proved the old behavior accepted duplicate inventory IDs, silently overwrote duplicate UID creation, allowed cross-release additions, retained an old UID after reload failure, and omitted owned equipment from production recommendation builds.

Final focused command:

```text
npm test -- src/profiles src/recommendations/RecommendationPage.test.tsx --maxWorkers=2
```

Result: 3 files and 20 tests passed.

An independent read-only reviewer initially found five issues. Fixes added duplicate-create rejection, immediate old-profile clearing plus request sequencing, version-safe inventory additions, real equipment allocation into Task 9, and a closed responsive CSS rule with a source-backed regression. Reviewer re-ran the focused tests and approved the final diff.

## Final verification

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npx vitest run --maxWorkers=2 --reporter=json`: 53/53 suites and 238/238 tests passed.
- `npm run validate:data`: passed.
- `npm run build`: passed; Vite transformed 156 modules.
- `git diff --check`: passed.

## Residual non-blocking gaps

Task 12 browser E2E should add a real 320px visual/interaction pass and real IndexedDB multi-tab concurrency coverage. Unit tests already cover reopen persistence through the injectable adapter, atomic import behavior, selection-race isolation, and responsive CSS source invariants.
