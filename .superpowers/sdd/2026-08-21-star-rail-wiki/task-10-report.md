# Task 10 report — Isolated multi-UID local profiles and JSON backup

## Scope

Implemented private browser-local profiles keyed by exact nine-digit UIDs, with IndexedDB persistence, deterministic JSON backup, inventory-aware recommendation allocation, optimistic concurrency, and accessible destructive confirmation. No credentials are stored and profile writes remain local.

## Fix R1 data and concurrency contract

- `ProfileDatabase` is schema version 2 and exposes create-only `create`, compare-and-swap `compareAndSwap`, atomic `transact`, and revision-checked deletion. Duplicate concurrent creates and stale partial edits fail with `ProfileConflictError`; rename and inventory edits merge only their owned fields inside the transaction.
- Both baseline v0 (`label`/`dataReleaseId`/optional publication) and renamed-field v0 (`displayName`/`releaseId`) are strictly parsed, migrated to v1, and written back lazily. Invalid stored records are isolated from healthy profiles and returned as `ProfileStorageIssue` entries.
- Real `fake-indexeddb` tests exercise v1-to-v2 open, v0 writeback, invalid-record isolation, blocked upgrade notification, and closing the active connection on `versionchange`.
- Import strictly validates the envelope and then resolves its `dataReleaseId` through the release bundle repository. Every character, light cone, and relic set must be an active revision of the correct kind before the single atomic transaction begins. Invalid release or stable-ID references leave storage unchanged.
- Export remains deterministic and sorted. Same-UID import requires explicit merge or replace; cross-release merge is rejected; deletion requires the exact UID and can reject a stale revision.

## Recommendation and UI integration

- Selected UID changes use the shared `selectProfileUid` path, which persists browser selection and broadcasts the selection event. Tests cover page switching, immediate old-state clearing on reload failure, and restoring the chosen UID and roster after remount.
- `allocateProfileMemberBuilds` intersects configured builds with authoritative inventory: eidolons and superimposition are capped, light cones require active correct-kind/path-compatible unique ownership, and relic pieces are globally consumed by instance count without reuse. Allocation/exclusion ordering is stable and the UI reports rejected or capped configuration.
- The delete dialog traps Tab/Shift+Tab, closes on Escape, restores focus to the opener, and marks the background inert while open.
- `/profiles` retains creation, selection, rename, inventory editing, version provenance, backup/import, mismatch warnings, and 320px responsive behavior.

## TDD and review evidence

RED regressions covered authoritative allocation and exclusion, concurrent duplicate create/stale update, real v0 migration, real IndexedDB upgrade events and corrupt-record isolation, atomic invalid-reference imports, persisted recommendation selection after remount, and delete-modal keyboard behavior.

An independent reviewer approved the original Task 10 implementation. Fix R1 received a second independent read-only review. Its initial pass found six edge cases; all were fixed with regressions, and the final pass approved the diff with 29/29 focused tests plus typecheck, lint, and diff checks passing.

## Final verification

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test -- --maxWorkers=2`: 36/36 files and 247/247 tests passed.
- `npm run validate:data`: passed.
- `npm run build`: passed; Vite transformed 157 modules.
- `git diff --check`: passed.

## Residual non-blocking gaps

Task 12 browser E2E can add a true two-window IndexedDB contention scenario and a 320px visual pass. The adapter tests already use the browser IndexedDB API model for upgrade/blocking behavior, while service tests cover atomic duplicate creation and stale partial-update rejection.
