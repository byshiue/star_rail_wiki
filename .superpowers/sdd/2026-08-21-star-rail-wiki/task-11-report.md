# Task 11 report — Explicit-consent public profiles

## Public/private boundary

- Local backup export remains unchanged and private. Public export uses a separate strict schema with `schemaVersion`, exact nine-digit `uid`, `releaseId`, `updatedAt`, `consentAt`, and minimized inventory fields.
- Display names, region, local database metadata, credential-like fields, and local relic instance IDs are not copied into a public payload.
- The publication component shows the UID, every inventory identifier, permanence risk, and Git/Pages history warning before consent. It creates no JSON artifact while consent is inactive and performs no upload, push, or token handling.

## Reviewed static workflow

- Public files are limited to `public/profiles/<uid>.json`; path construction and repository validation reject traversal, nested paths, non-JSON files, UID mismatches, files over 1 MiB, unexpected fields, suspected secrets, unsupported versions, duplicate inventory IDs, unreleased/unknown releases, and unknown active game IDs.
- `public/profiles/index.json` is a checked-in whitelist. Validation rejects duplicate UIDs, missing files, unindexed files, and UID/timestamp reference mismatches.
- The public route loads the index before a profile, validates both responses, rejects cross-UID content, and exposes safe loading, not-found, and validation-error states. It never displays unindexed or invalid payloads.
- The UI only downloads JSON and links to a GitHub new-file page with a prefilled filename. Forking, index editing, and Pull Request submission remain explicit manual steps.

## Documentation and withdrawal

`docs/profile-publication.md` documents publication, correction, and withdrawal. Withdrawal requires a later Pull Request to remove both file and index entry; the documentation and public page state that Git, caches, and GitHub Pages history may retain previous public revisions.

## Verification

- Focused publication and validator tests: 20/20 passed.
- Profile regression scope: 44/44 passed.
- Full low-concurrency suite: 64/64 suites and 270/270 tests passed.
- TypeScript, ESLint, public-profile validation, full repository data validation, production build, and `git diff --check`: passed.
- No external repository write or push was performed; external publication remains Task 12/user-controlled work.
