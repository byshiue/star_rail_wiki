# Offline Wiki PDF Design

## Objective

Add a reproducible, local-only documentation pipeline to this repository. It produces an illustrated, searchable Simplified Chinese offline encyclopedia for the released Chinese version of Honkai: Star Rail while keeping generated PDFs, downloaded official artwork, source caches, credentials, and unreviewed Agent drafts out of Git and GitHub.

The encyclopedia consists of five PDFs: a global index, characters, light cones, relics, and Divergent Universe. Numeric gameplay content is versioned and attributable. Story content is an original summary drafted locally and admitted to a release only after human review.

## Architecture

The pipeline is independent from the browser application but reuses the repository's pinned release bundles:

```text
public/data/releases/<release>
              +
reviewed summaries and source manifests
              ↓
normalized document catalog
              ↓
version gap and change report
              ↓
HTML volume renderer
              ↓
local PDF renderer and build manifest
```

GitHub validates schemas, source metadata, review state, deterministic rendering fixtures, links, and repository hygiene. Full PDF production remains a local operation.

## Repository and Local Storage Boundaries

Committed content:

- generator source and tests;
- templates and font configuration, but only redistributable fonts;
- source and image manifests containing metadata and URLs, not downloaded official assets;
- original, reviewed story summaries;
- document schema and version metadata;
- GitHub Actions validation.

Ignored local content:

```text
.local/offline-wiki/
├── assets/
├── drafts/
├── builds/<release>/
└── archives/<release>/
```

The local area contains downloaded images, Agent drafts, intermediate HTML, PDFs, and historical PDF archives. No command may automatically stage, commit, or upload this directory.

## Data Model

Every document entity has:

- `logicalId`, display name, and entity type;
- `releaseId` and game version;
- one or more provenance records with source name, exact URL, immutable revision where available, retrieval date, source path, and checksum;
- document change state: `added`, `changed`, `unchanged`, or `pending-review`;
- reviewed story summary reference when applicable;
- optional image manifest reference;
- source-derived gameplay sections appropriate to the entity.

Reviewed summaries have an entity ID, locale, original summary text, source references, content checksum, reviewer identity label, review timestamp, and `reviewed` status. Unreviewed drafts use the same shape but stay under `.local/offline-wiki/drafts/` and never enter formal output.

Image manifest records contain entity ID, asset role, HTTPS source URL, allowed host, expected media type, optional checksum, attribution text, and local cache key. The manifest is safe to publish; downloaded files are not.

## Sources and Content Policy

Source precedence is:

1. pinned released game-resource bundles already audited by this repository for abilities, traces, eidolons, light-cone effects, and relic-set effects;
2. official public pages for cross-checking introductions, story facts, Divergent Universe entries, and image indexes;
3. explicitly identified third-party public sources only for documented gaps.

Gameplay facts and numbers are presented in the project's own structured layout. Story sections are original summaries, not copies of full official story prose. The project does not implement an unattended whole-site HoYoWiki mirror. Updates operate on a reviewed source manifest, use public endpoints only, and require no cookies, account credentials, or private APIs.

Divergent Universe uses a document-only adapter with its own pinned source snapshots and provenance. Blessings, equations, curios, weighted curios, occurrences, tutorials, Probability Museum content, and operational records may be represented. An entry without an adequate source is reported as missing rather than inferred.

## Volumes and Layout

The pipeline produces:

1. `00-总索引.pdf`: release metadata, coverage, changes, and cross-volume page index.
2. `01-角色图鉴.pdf`: splash art, introduction, element/path, abilities, traces, eidolons, story summary, and provenance.
3. `02-光锥图鉴.pdf`: artwork, path, base information, superimposition effects, story summary, applicable-character index, and provenance.
4. `03-遗器图鉴.pdf`: set and piece art, thresholds and effects, story summary, recommended-user index, and provenance.
5. `04-差分宇宙图鉴.pdf`: blessings, equations, curios, weighted curios, occurrences, tutorials, operational records, effects, associations, story summaries, and provenance.

All volumes use A4 pages, embedded Chinese fonts, searchable text, hierarchical bookmarks, tables of contents, page numbers, internal links, return-to-index links, release headers, and source footers. The default asset profile is illustrated-encyclopedia quality with a configurable compression level. Missing optional images render an explicit placeholder.

Historical releases are immutable local directories under `.local/offline-wiki/archives/<release>/`.

## Commands and Workflow

- `npm run docs:prepare -- --release <id>` validates the release, normalizes data, compares the previous release, and writes a coverage/change report.
- `npm run docs:draft -- --release <id>` optionally invokes a locally configured Agent and writes only unreviewed local drafts.
- `npm run docs:review` starts a loopback-only review UI that can accept, edit, or reject drafts. Accepted original summaries are promoted into committed reviewed data by an explicit user action.
- `npm run docs:assets -- --release <id>` downloads only manifest-listed HTTPS images after host, type, size, and checksum validation.
- `npm run docs:build -- --release <id>` renders HTML, five PDFs, and `build-manifest.json` locally.
- `npm run docs:verify -- --release <id>` checks coverage, provenance, summary state, assets, fonts, bookmarks, links, and Git hygiene.

The build fails when core gameplay data, release identity, provenance, or a declared checksum is missing or invalid. An unreviewed summary is omitted and reported. A missing optional image produces a labeled placeholder and does not stop a text-complete build.

## Security and Failure Behavior

- Asset fetching accepts only manifest-listed HTTPS URLs on an allowlist.
- Responses have byte limits and verified media types; declared checksums fail closed.
- Redirect targets are revalidated against the allowlist.
- No cookies, tokens, user profiles, scanner files, or account inventory enter document inputs.
- Mutable `latest` references are rejected for formal builds; a released ID and exact source revisions are required.
- Parser or upstream page changes create visible errors or coverage gaps; they cannot silently emit empty formal sections.
- Repository validation rejects local output, official binary assets, secret-like files, and Agent drafts if tracked.

## Test Strategy

- schema tests for document entities, summaries, image manifests, and Divergent Universe records;
- catalog normalization tests against small committed fixtures;
- release comparison tests for added, changed, unchanged, and pending-review states;
- deterministic HTML snapshot tests;
- asset allowlist, redirect, size, type, and checksum tests;
- PDF smoke tests for page count, bookmarks, internal links, and embedded Chinese fonts;
- failure tests for missing provenance, missing core gameplay content, unreviewed summaries, missing images, upstream shape changes, and checksum drift;
- repository hygiene and secret scanning integrated with existing checks.

## Delivery Phases

1. Document core: schemas, release reader, normalized catalog, gap/change report, CLI, and repository boundaries.
2. Existing-content volumes: character, light-cone, and relic HTML rendering with source/version metadata.
3. Local assets: safe image manifest downloader, cache, placeholders, and compression profiles.
4. Summary workflow: local draft format, loopback review UI, explicit promotion, and coverage gates.
5. PDF output: five-volume orchestration, embedded font, bookmarks, internal links, indexes, and build manifest.
6. Divergent Universe: adapter, reviewed sample, then incremental full coverage.
7. CI and documentation: validation-only workflow, clean-machine instructions, and release-update guide.

The first usable milestone produces complete character, light-cone, and relic text volumes from the current pinned release plus a sample Divergent Universe volume. Full Divergent Universe coverage grows only from reviewed, attributable sources.

## Acceptance Criteria

- A fresh clone can install dependencies and run `docs:prepare` for a committed released bundle without credentials.
- The report identifies coverage gaps and version changes deterministically.
- After locally acquiring allowed assets and reviewing summaries, `docs:build` creates the five named PDFs and a manifest under the ignored local directory.
- Every formal gameplay entry names its release and source; every story section is marked as an original reviewed summary.
- Generated PDFs, caches, official images, credentials, user account data, and unreviewed drafts cannot be included in a normal repository validation run.
- GitHub Actions can validate the workflow without an Agent key and without publishing full PDFs.
