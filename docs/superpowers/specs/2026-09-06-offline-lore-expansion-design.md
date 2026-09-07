# Offline Lore Expansion Design

## Objective

Extend the existing local-only Honkai: Star Rail offline Wiki for the exact
`4.4-cn-2026-08-21` release with four content families:

1. Divergent Universe;
2. worldview;
3. missions and story chronology;
4. collectible text.

The repository publishes structured mechanics, factual metadata, original
summaries, relationships, source metadata, and the tooling needed to build the
documents. Copyrighted long-form source text is accepted only from files the
user supplies locally, remains below `.local/offline-wiki/`, and is never
tracked or uploaded by this project.

## Fixed Release Boundary

All formal records in this expansion are bound to
`4.4-cn-2026-08-21`. The importer rejects `latest`, records labeled for another
release, and records whose release cannot be established. A current HoYoWiki
page may be used to discover a candidate or cross-check a fact, but it is not by
itself proof that the candidate existed in 4.4 because the public site may
already contain later content.

A formal 4.4 baseline must be supported by one of:

- an immutable source revision whose date and released-client identity are
  compatible with 4.4;
- a user-supplied local manifest that identifies a 4.4 export and checksums
  every input file;
- a separately reviewed record with entry-level official evidence showing the
  content was released no later than 4.4.

An unsupported candidate remains in a rejection or gap report and cannot
increase the coverage percentage.

## Two-Layer Architecture

The committed and local layers are deliberately separate:

```text
committed 4.4 catalog, mechanics, summaries, relations, provenance
                              +
ignored user-supplied local full-text corpus and optional local assets
                              ↓
              release-locked normalized lore catalog
                              ↓
              coverage, rejection, and relationship reports
                              ↓
                   grouped HTML/PDF volumes
```

Committed content lives under `data/offline-wiki/lore/`. It can contain short
mechanical descriptions, factual fields, original summaries, relationships,
source revisions, and checksums. It cannot contain copied long-form official
prose.

Local source material lives under
`.local/offline-wiki/imports/4.4-cn-2026-08-21/`. It may contain complete text
that the user legally obtained. A normalized local overlay binds each full-text
record to the same logical ID, release, locale, source revision, and source
checksum as the public catalog. Build outputs continue to live under
`.local/offline-wiki/builds/4.4-cn-2026-08-21/`.

Repository hygiene must fail if local imports, normalized full text, generated
HTML/PDF files, or downloaded official assets are tracked by Git.

## Content Taxonomy

### Divergent Universe

Supported kinds are:

- blessing;
- equation;
- curio;
- weighted curio;
- occurrence;
- tutorial;
- Probability Museum entry;
- operational record.

Records may carry rarity, path, activation or enhancement requirements,
mechanical effect, enhanced effect, related entries, and an original background
summary.

### Worldview

Supported kinds are:

- Aeon;
- Path;
- faction;
- location or world;
- term;
- NPC;
- enemy or boss.

Worldview records prioritize identity, aliases, affiliation, parent location,
related Paths or Aeons, first known release, and relationships to missions and
collectibles. Narrative prose is represented by an original summary unless a
matching local full-text overlay is available.

### Missions and Story Chronology

Supported mission families are:

- Trailblaze Mission;
- Companion Mission;
- Adventure Mission;
- permanent event story;
- time-limited event story released by 4.4.

Mission records contain chapter and section identifiers, display order,
prerequisites, locations, participating entities, a concise objective or
mechanical description when available, an original plot summary, and links to
locally supplied dialogue sections. Choices and branches remain structured;
the importer must not flatten mutually exclusive dialogue into a false linear
transcript.

### Collectible Text

Supported kinds are:

- book or readable;
- inventory item background;
- achievement;
- message or chat thread;
- phonograph entry;
- tutorial;
- other in-game collectible text admitted through review.

Records contain series and part ordering where applicable, region, author or
sender when stated, unlock condition when available, related entities, and an
original summary. Long bodies and message transcripts exist only in the local
overlay.

## Data Model

Every committed lore record shares these fields:

- `logicalId`: stable namespaced ID;
- `family` and `kind`: one of the approved taxonomy values;
- `name` and optional aliases;
- `releaseId`: exactly `4.4-cn-2026-08-21` for this release;
- `locale`: `zh-CN`;
- optional short structured mechanics;
- an optional original summary in the existing summary collection, keyed by the
  same logical ID and carrying reviewed or explicitly unreviewed generation
  status;
- typed relationships to other logical IDs;
- one or more provenance records containing source name, exact URL when
  public, immutable revision or reviewed capture identity, source path, and
  SHA-256 checksum;
- a checksum over the normalized committed record.

Family-specific fields are modeled as a discriminated union so a mission cannot
silently accept a blessing field and a collectible cannot silently accept a
mission prerequisite. Relationships use a closed set of types such as
`located-in`, `member-of`, `follows`, `requires`, `features`, `mentions`, and
`related-to`. A validation pass rejects dangling relationship targets within a
release unless the target is explicitly declared external.

The local full-text overlay contains:

- the same `logicalId`, `releaseId`, and `locale`;
- the committed source identity it is expected to match;
- ordered text sections with optional speaker, branch, volume, or page labels;
- input and normalized-content checksums;
- a local import timestamp and adapter version.

The overlay never changes the committed record or its coverage status. It adds
a separate `fullTextAvailable` dimension to local build coverage.

## Local Import Contract

The primary interface is a documented canonical JSONL format. Source-specific
adapters convert user-supplied saved HoYoWiki HTML/JSON or a compatible local
game-data directory into that format. Adapters read only the explicitly supplied
source root and do not fetch missing pages.

The command shape is:

```bash
npm run docs:import-lore -- \
  --release 4.4-cn-2026-08-21 \
  --manifest /absolute/local/path/manifest.json \
  --source-root /absolute/local/path/source
```

The manifest declares source name, locale, release evidence, source revision or
capture identity, adapter, included families, retrieval or export time, and a
SHA-256 checksum for every input file. It also records that the inputs were
provided locally by the user. No authentication material is accepted or saved.

Import is transactional. It parses into a temporary local directory, validates
the entire batch, and atomically promotes the normalized overlay only when the
batch passes. It never partially overwrites the prior good import.

## Public Metadata and Summary Acquisition

The agent may use public official directory pages to discover categories and
candidates, then seek entry-level release evidence. It may retain short
mechanical facts and produce original summaries with exact provenance. It may
not create an unattended full-site mirror or copy long-form official text from
the network.

Third-party datasets are not authoritative merely because they expose more
fields. Any such source must have an immutable revision, a documented license
for its own code, entry-level checksums, and independent 4.4 release evidence.
The license of a community repository does not grant rights to embedded game
text or artwork. Sources affected by takedown or unclear redistribution status
may be used only as locally supplied inputs, not as committed corpus material.

When no defensible 4.4 source exists, the system reports the record as missing.
It must not infer a 4.4 baseline from current 4.5-capable pages.

## Output Volumes

The global index remains `00-总索引.pdf`. Existing character, light-cone, and
relic volumes remain unchanged. New flat filenames use these prefixes:

- `04-差分宇宙-`;
- `05-世界观-`;
- `06-剧情-`;
- `07-文本收藏-`.

Each family produces an index PDF plus content PDFs grouped by the taxonomy
above. The renderer may split a large subgroup into deterministic parts based
on entry count while preserving stable ordering and links. The global index
links to each family index; family indexes link to subgroup entries and show
related records in other volumes.

If a verified local full-text overlay exists, local HTML/PDF includes the
ordered full text with a local-source notice. Without it, the entry displays its
committed summary and source link. Missing content is never replaced with
invented prose.

All outputs remain searchable, use embedded Chinese fonts, carry release and
source information, and are generated without network access. HTML rendering
escapes all text. Saved HTML input is parsed into a small allowlisted document
model; scripts, styles, event handlers, forms, iframes, remote media, and unsafe
URLs are discarded.

## Coverage and Rejection Reports

Coverage is reported separately for every family and kind:

- expected 4.4 entries;
- structured records present;
- original summaries present;
- locally available full text;
- reviewed and auto-generated counts;
- records lacking source or release evidence;
- rejected later-version or ambiguous candidates;
- dangling or invalid relationships.

Until a trustworthy expected-entry baseline exists, the report says
`baselineStatus: "missing"` and does not calculate a percentage. A candidate
list or current website count cannot substitute for the baseline.

Every rejection contains a stable reason code and enough source identity to
reproduce the decision without retaining rejected long-form text in Git.

## Failure and Security Behavior

- Reject `latest`, non-4.4 release IDs, checksum mismatch, undeclared input
  files, duplicate logical IDs, unknown kinds, invalid relationship types, and
  path traversal.
- Do not follow symlinks outside the declared source root.
- Apply per-file and total-batch size limits before parsing.
- Reject malformed UTF-8 and normalize line endings deterministically.
- Sanitize locally supplied HTML and disallow network access while rendering.
- Never accept cookies, tokens, account exports, scanner profiles, or other
  personal data as lore inputs.
- Preserve the last successful local import when a new import fails.
- Keep rejected source bodies local and write only reason metadata to a
  publishable report.

## Testing Strategy

Committed tests use short, original fixture prose and never contain official
long-form text. Tests cover:

- the discriminated lore schemas and relationship validation;
- successful imports for all four families;
- exact 4.4 acceptance and rejection of `latest`, 4.5, and ambiguous records;
- manifest and file checksum drift;
- undeclared files, path traversal, unsafe symlinks, duplicate IDs, malformed
  UTF-8, and size limits;
- transactional rollback after a failed batch;
- saved-HTML sanitization and script/remote-request removal;
- summary-only rendering and local-full-text rendering;
- deterministic grouping, indexes, and cross-volume links;
- coverage with and without an expected-entry baseline;
- repository rejection of local imports, official full text, generated PDFs,
  and downloaded assets;
- PDF smoke tests proving searchable Chinese text and zero remote requests.

The full repository `npm run check`, offline repository hygiene, and PDF
verification remain release gates.

## Delivery Sequence

1. Add common lore schemas, four family unions, relationships, committed
   fixtures, and repository hygiene rules.
2. Add manifest validation, canonical JSONL import, transactional local storage,
   rejection reports, and security tests.
3. Add source adapters for user-supplied HoYoWiki HTML/JSON and compatible local
   game-data directories.
4. Extend the document catalog and coverage report with baselines, summaries,
   local full-text availability, and rejection counts.
5. Add the four family indexes, deterministic subgroup volumes, relationship
   links, and safe local full-text rendering.
6. Research and admit attributable 4.4 structured mechanics, metadata, and
   original summaries family by family. Anything without adequate 4.4 evidence
   stays a visible gap.
7. Build and verify the local 4.4 HTML/PDF set. Full-text completeness remains
   dependent on a user-provided lawful local corpus.

## Acceptance Criteria

- All four families have validated schemas, catalog support, coverage reporting,
  and deterministic index/PDF generation.
- Formal records cannot enter the 4.4 catalog without exact release and source
  evidence.
- The importer reads only user-supplied local paths, validates every file, and
  never fetches missing content.
- Long-form source text, local imports, downloaded assets, and generated output
  cannot be tracked by the repository.
- Short structured mechanics and original summaries can be maintained in Git
  with source revisions and checksums.
- Local full text is included only when its overlay matches the committed record
  and 4.4 source identity; otherwise the renderer falls back visibly to the
  summary.
- Coverage never reports 100% without a trustworthy expected-entry baseline.
- A failed import cannot damage the prior successful local corpus.
- All security, schema, repository, build, and PDF checks pass without network
  access during document generation.
