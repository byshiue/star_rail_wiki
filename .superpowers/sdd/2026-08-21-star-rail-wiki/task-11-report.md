# Task 11 report — Explicit-consent public profiles

## Public/private boundary

- Local backup export remains unchanged and private. Public export uses a separate strict schema with `schemaVersion`, exact nine-digit `uid`, `releaseId`, `updatedAt`, nested `publication: { visibility: "public", consentedAt }`, and minimized inventory fields.
- Display names, region, local database metadata, credential-like fields, and local relic instance IDs are not copied into a public payload.
- The publication component shows the UID, every inventory identifier, permanence risk, and Git/Pages history warning before consent. It creates no JSON artifact while consent is inactive and performs no upload, push, or token handling.

## Reviewed static workflow

- Public files are limited to `public/profiles/<uid>.json`; path construction and repository validation reject traversal, nested paths, non-JSON files, UID mismatches, files over 1 MiB, unexpected fields, suspected secrets, unsupported versions, duplicate inventory IDs, unreleased/unknown releases, and unknown active game IDs.
- `public/profiles/index.json` is a checked-in whitelist. Validation rejects duplicate UIDs, missing files, unindexed files, and UID/timestamp reference mismatches.
- The public route loads the index before a profile, validates both responses, rejects cross-UID content, and exposes safe loading, not-found, and validation-error states. It never displays unindexed or invalid payloads.
- The UI only downloads JSON and links to a GitHub new-file page with a prefilled filename. Forking, index editing, and Pull Request submission remain explicit manual steps.

## Documentation and withdrawal

`docs/profile-publication.md` documents publication, correction, and withdrawal. Withdrawal requires a later Pull Request to remove both file and index entry; the documentation and public page state that Git, caches, and GitHub Pages history may retain previous public revisions.

## Fix R1 contract and accessibility hardening

- Client loading and CI validation now consume the same strict `PublicProfileIndexSchema`; CI also recursively scans the complete index for token, cookie, and other credential-like keys or values.
- Consent and generated artifacts are synchronously bound to the exact `{ uid, updatedAt }` revision, so a rapid account/revision switch cannot render the previous checkbox state or JSON even before effects run.
- The obsolete flat `consentAt` public contract is rejected. Nested `publication.consentedAt` must be at or after `updatedAt`.
- The pre-consent DOM lists each character's eidolon/level, each light cone's superimposition/level, and every public relic set/slot. Successful generation announces a polite live status and focuses it; loading, not-found, and validation errors expose safe status semantics.
- R1 tests cover strict/recursive index rejection, rapid profile switching, every preview value, focus/live behavior, timestamp tampering, unreleased and wrong-kind references, and one-pass non-JSON/nested/orphan repository failures.

## Fix R2 clock-policy boundary

- `PublicAccountProfileSchema` now contains only content invariants and never reads the visitor's current clock. A visitor clock ten minutes behind a valid merged profile can still parse and display it.
- The five-minute future-skew policy runs only when the browser creates a publication artifact and when CI validates a submitted profile against its build clock.

## Verification

- R2 focused regressions: 3/3 passed; all original, R1, and R2 publication/validator tests: 36/36 passed.
- Full low-concurrency suite: 75/75 suites and 286/286 tests passed.
- Typecheck, lint, standalone public-profile validation, full repository data validation, production build, and staged diff checks passed.
- No external repository write or push was performed; external publication remains Task 12/user-controlled work.
