# Offline Lore Expansion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the local 4.4 offline Wiki with validated Divergent Universe, worldview, mission, and collectible-text catalogs, plus a secure local-only full-text importer and grouped searchable PDF output.

**Architecture:** Add a committed normalized lore layer for short mechanics, facts, summaries, relationships, and provenance, then merge it at build time with an ignored local full-text overlay. Every import and render remains release-locked to `4.4-cn-2026-08-21`; coverage distinguishes a proven baseline, committed records, summaries, local full text, and rejected candidates.

**Tech Stack:** TypeScript 7, Node.js 24 filesystem APIs, Zod 4, Vitest 4, existing Playwright PDF renderer, existing offline-Wiki HTML renderer.

**Spec:** `docs/superpowers/specs/2026-09-06-offline-lore-expansion-design.md`

## Global Constraints

- Formal production lore in this plan is locked to `4.4-cn-2026-08-21`; reject `latest`, 4.5, and ambiguous release evidence.
- Committed data may contain short structured mechanics, facts, original summaries, relationships, provenance, and checksums, but no copied long-form official prose.
- Full text is accepted only from user-supplied local files beneath `.local/offline-wiki/imports/<release>/` and must never be tracked.
- Importers read only an explicit local source root and perform no network requests.
- HTML/PDF generation performs no network requests and visibly falls back to an original summary when local full text is absent.
- Existing user files `docs/character-buffs-4.4-cn-2026-08-21.csv`, `scripts/export-character-buffs.ts`, and `scripts/export-character-buffs.test.ts` are outside this plan and must not be staged or edited.
- Tests use short original fixture prose; no official long-form fixture text may enter Git.

---

### Task 1: Define the committed lore and relationship schemas

**Files:**
- Create: `scripts/offline-wiki/lore/schema.ts`
- Create: `scripts/offline-wiki/lore/schema.test.ts`
- Modify: `scripts/offline-wiki/schema.ts`

**Interfaces:**
- Produces: `LoreRecordSchema`, `LoreRecord`, `LoreFamily`, `LoreRelationship`, `LoreBaselineSchema`, and `LoreBaseline`.
- Consumes: `EntityProvenanceSchema` and the existing SHA-256/provenance conventions.
- Extends: `StoryEntityKindSchema` with `lore` so existing reviewed and
  auto-generated summary records can attach to lore logical IDs.

- [ ] **Step 1: Write failing schema tests for all four families**

Create fixture builders inside `schema.test.ts` and assert that the following records parse:

```ts
const provenance = [{
  sourceName: "Official fixture",
  sourceUrl: "https://wiki.hoyolab.com/pc/hsr/entry/1",
  sourceRevision: "fixture-revision",
  sourcePath: "entry/1",
  sourceChecksum: `sha256:${"a".repeat(64)}`,
}];

expect(LoreRecordSchema.parse({
  logicalId: "lore:du:equation:1",
  family: "divergent-universe",
  kind: "equation",
  name: "测试方程",
  aliases: [],
  releaseId: "4.4-fixture",
  locale: "zh-CN",
  description: "短机制说明。",
  mechanics: { rarity: 3, path: "巡猎", effect: "测试效果。", enhancedEffect: null },
  relationships: [],
  provenance,
  reviewStatus: "reviewed",
  contentChecksum: `sha256:${"b".repeat(64)}`,
})).toMatchObject({ family: "divergent-universe", kind: "equation" });
```

Add analogous valid records for `worldview/faction`, `mission/companion`, and
`collectible/readable`. Assert rejection of a mission carrying `mechanics`, an
unknown relationship type, a dangling namespace such as `bad-id`, `locale:
"en-US"`, and an empty provenance array.

Add a `StorySummarySchema` assertion for `entityKind: "lore"` and
`logicalId: "lore:worldview:faction:1"`; retain rejection of unrecognized
entity kinds.

- [ ] **Step 2: Run the schema test and confirm the missing-module failure**

Run: `npx vitest run scripts/offline-wiki/lore/schema.test.ts`

Expected: FAIL because `./schema` does not exist.

- [ ] **Step 3: Implement strict discriminated schemas**

Create these enums and common shapes in `lore/schema.ts`:

```ts
export const LoreFamilySchema = z.enum([
  "divergent-universe", "worldview", "mission", "collectible",
]);

export const LoreRelationshipTypeSchema = z.enum([
  "located-in", "member-of", "follows", "requires",
  "features", "mentions", "related-to",
]);

export const LoreRelationshipSchema = z.strictObject({
  type: LoreRelationshipTypeSchema,
  targetLogicalId: z.string().regex(/^(?:lore|character|light-cone|relic-set):/),
  external: z.boolean().default(false),
});
```

Build four `z.strictObject` family schemas sharing `logicalId`, `name`,
`aliases`, `releaseId`, `locale`, `description`, `relationships`, `provenance`,
`reviewStatus`, and `contentChecksum`. Use a discriminated union on `family`.
The exact kind sets are those in the approved spec. Define `LoreBaselineSchema`
with `releaseId`, `family`, `baselineStatus: "complete" | "missing"`, nullable
`expectedCount`, source provenance, and checksum; refine it so `complete`
requires a non-null expected count and provenance.

Re-export only the types needed by the older offline-Wiki modules from
`scripts/offline-wiki/schema.ts`; keep family details in the focused lore file.
Add `lore` to `StoryEntityKindSchema` without changing the existing summary
review-status union.

- [ ] **Step 4: Run schema tests**

Run: `npx vitest run scripts/offline-wiki/lore/schema.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the schema task**

```bash
git add scripts/offline-wiki/lore/schema.ts scripts/offline-wiki/lore/schema.test.ts scripts/offline-wiki/schema.ts
git commit -m "feat: define offline lore schemas"
```

### Task 2: Load committed lore, verify record checksums, and validate relationships

**Files:**
- Create: `scripts/offline-wiki/lore/catalog.ts`
- Create: `scripts/offline-wiki/lore/catalog.test.ts`
- Create: `scripts/offline-wiki/__fixtures__/lore/4.4-fixture/baselines.json`
- Create: `scripts/offline-wiki/__fixtures__/lore/4.4-fixture/divergent-universe.json`
- Create: `scripts/offline-wiki/__fixtures__/lore/4.4-fixture/worldview.json`
- Create: `scripts/offline-wiki/__fixtures__/lore/4.4-fixture/missions.json`
- Create: `scripts/offline-wiki/__fixtures__/lore/4.4-fixture/collectibles.json`
- Create: `data/offline-wiki/lore/4.4-cn-2026-08-21/baselines.json`
- Create: `data/offline-wiki/lore/4.4-cn-2026-08-21/divergent-universe.json`
- Create: `data/offline-wiki/lore/4.4-cn-2026-08-21/worldview.json`
- Create: `data/offline-wiki/lore/4.4-cn-2026-08-21/missions.json`
- Create: `data/offline-wiki/lore/4.4-cn-2026-08-21/collectibles.json`
- Create: `data/offline-wiki/summaries/lore.json`
- Modify: `scripts/offline-wiki/editorial.ts`
- Modify: `scripts/offline-wiki/editorial.test.ts`

**Interfaces:**
- Produces: `loadLoreCatalog(root, releaseId): LoreCatalog` and `validateLoreRelationships(records): void`.
- Consumes: Task 1 schemas.

- [ ] **Step 1: Write failing catalog tests**

Test that the fixture loads one record per family, sorts by Chinese name then
logical ID, verifies each record checksum, and preserves a missing baseline
without inventing a percentage. Test that `loadEditorialData` reads a valid
`summaries/lore.json` record with `entityKind: "lore"`. Add mutation tests for
checksum drift, cross-release records, duplicate logical IDs, and a
non-external dangling relationship.

Use a checksum helper over canonical JSON excluding `contentChecksum`; the
expected canonical field order is enforced by reconstructing the parsed object
before `JSON.stringify`, not by trusting input key order.

- [ ] **Step 2: Run the catalog test and confirm failure**

Run: `npx vitest run scripts/offline-wiki/lore/catalog.test.ts`

Expected: FAIL because `loadLoreCatalog` is missing.

- [ ] **Step 3: Implement release-locked loading and graph validation**

`LoreCatalog` has this stable public shape:

```ts
export type LoreCatalog = {
  releaseId: string;
  records: LoreRecord[];
  byFamily: Record<LoreFamily, LoreRecord[]>;
  baselines: LoreBaseline[];
};
```

Require an exact release directory and all five JSON files. Verify every record
belongs to the requested release. Reject duplicate IDs before constructing the
map. A relationship to a `lore:` ID must resolve within the catalog unless
`external` is true; existing character/light-cone/relic targets are validated
later when the document catalog is assembled.

Create production files as empty arrays and four `baselineStatus: "missing"`
records. Create `data/offline-wiki/summaries/lore.json` as an empty array and
include that filename in `loadEditorialData`. This is an honest initial state,
not a completed-data claim.

- [ ] **Step 4: Run catalog tests and repository data validation**

Run: `npx vitest run scripts/offline-wiki/lore/catalog.test.ts`

Expected: PASS.

Run: `npm run validate:data`

Expected: PASS with the empty, explicitly missing production baselines.

- [ ] **Step 5: Commit the catalog task**

```bash
git add scripts/offline-wiki/lore/catalog.ts scripts/offline-wiki/lore/catalog.test.ts scripts/offline-wiki/__fixtures__/lore data/offline-wiki/lore data/offline-wiki/summaries/lore.json scripts/offline-wiki/editorial.ts scripts/offline-wiki/editorial.test.ts
git commit -m "feat: load versioned offline lore catalogs"
```

### Task 3: Enforce the local full-text manifest and repository boundary

**Files:**
- Create: `scripts/offline-wiki/lore/import/manifest.ts`
- Create: `scripts/offline-wiki/lore/import/manifest.test.ts`
- Modify: `scripts/offline-wiki/repository-hygiene.ts`
- Modify: `scripts/offline-wiki/repository-hygiene.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `loadLocalLoreManifest(path, expectedReleaseId, sourceRoot): LocalLoreManifest`.
- Consumes: Task 1 family enums.

- [ ] **Step 1: Write failing manifest and hygiene tests**

Define the accepted manifest fixture:

```ts
const manifest = {
  schemaVersion: 1,
  releaseId: "4.4-fixture",
  locale: "zh-CN",
  source: {
    name: "User-provided fixture export",
    revision: "fixture-revision",
    exportedAt: "2026-09-06T00:00:00.000Z",
  },
  adapter: "canonical-jsonl",
  adapterVersion: 1,
  families: ["worldview"],
  userProvided: true,
  files: [{ path: "worldview.jsonl", bytes: 128, checksum: `sha256:${"a".repeat(64)}` }],
};
```

Assert rejection of `latest`, 4.5, `userProvided: false`, absolute file paths,
`..` traversal, duplicate paths, undeclared files, byte-count mismatch,
checksum mismatch, files over 16 MiB, batches over 512 MiB, and symlinks that
escape `sourceRoot`.

Extend hygiene tests to reject tracked paths containing
`official-full-text`, `full-text-overlay`, or `source-cache` below
`data/offline-wiki/`, in addition to all `.local/offline-wiki/` paths.

- [ ] **Step 2: Run the tests and confirm failure**

Run: `npx vitest run scripts/offline-wiki/lore/import/manifest.test.ts scripts/offline-wiki/repository-hygiene.test.ts`

Expected: FAIL because the manifest loader and new hygiene rules are absent.

- [ ] **Step 3: Implement fail-closed manifest validation**

Resolve every declared path relative to the real source root. Use `lstatSync`
and `realpathSync` to reject escaping symlinks. Check size before reading,
verify strict UTF-8 with `TextDecoder("utf-8", { fatal: true })`, then compare
SHA-256. Recursively list regular files below the root and reject any file not
declared by the manifest, excluding the manifest itself when it is inside the
source root.

Keep `.local/offline-wiki/` ignored. Add explicit comments explaining that all
imports, normalized overlays, rejected bodies, and generated documents belong
there.

- [ ] **Step 4: Run manifest and hygiene tests**

Run: `npx vitest run scripts/offline-wiki/lore/import/manifest.test.ts scripts/offline-wiki/repository-hygiene.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the boundary task**

```bash
git add .gitignore scripts/offline-wiki/lore/import/manifest.ts scripts/offline-wiki/lore/import/manifest.test.ts scripts/offline-wiki/repository-hygiene.ts scripts/offline-wiki/repository-hygiene.test.ts
git commit -m "feat: validate local lore source manifests"
```

### Task 4: Implement canonical JSONL parsing and transactional local imports

**Files:**
- Create: `scripts/offline-wiki/lore/import/canonical.ts`
- Create: `scripts/offline-wiki/lore/import/canonical.test.ts`
- Create: `scripts/offline-wiki/lore/import/transaction.ts`
- Create: `scripts/offline-wiki/lore/import/transaction.test.ts`
- Create: `scripts/offline-wiki/lore/import/cli.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `parseCanonicalLoreJsonl(text, manifest): LocalFullTextRecord[]`.
- Produces: `importLocalLore(options): LocalImportReport`.
- Adds command: `npm run docs:import-lore -- --release <id> --manifest <path> --source-root <path>`.

- [ ] **Step 1: Write failing canonical format tests**

The normalized full-text record shape is:

```ts
type LocalFullTextRecord = {
  logicalId: string;
  family: LoreFamily;
  kind: string;
  name: string;
  releaseId: string;
  locale: "zh-CN";
  sourceRevision: string;
  sourcePath: string;
  sourceChecksum: `sha256:${string}`;
  sections: Array<{
    order: number;
    title: string | null;
    speaker: string | null;
    branch: string | null;
    body: string;
  }>;
  inputChecksum: `sha256:${string}`;
  contentChecksum: `sha256:${string}`;
  importedAt: string;
  adapterVersion: number;
};
```

Test CRLF normalization, stable section order, checksum derivation, empty-body
rejection, duplicate IDs, duplicate section order, and family mismatch with the
manifest.

- [ ] **Step 2: Write a failing transactional rollback test**

Start with a valid `normalized/current.jsonl`, run an import whose second input
line is invalid, and assert byte-for-byte preservation of the old file. Then
run a valid import and assert atomic replacement plus a report containing
accepted/rejected counts and checksums.

- [ ] **Step 3: Run the focused tests and confirm failure**

Run: `npx vitest run scripts/offline-wiki/lore/import/canonical.test.ts scripts/offline-wiki/lore/import/transaction.test.ts`

Expected: FAIL because the parser and transaction modules do not exist.

- [ ] **Step 4: Implement canonical parsing and atomic promotion**

Parse one strict JSON object per non-empty line. Normalize newlines to `\n` and
sort sections by numeric `order`; do not merge branches. Write the candidate
overlay and report beneath a `mkdtempSync` staging directory adjacent to the
target. Validate by reading the staged result back, then rename the existing
directory to a backup, promote staging, and remove the backup only after the
promotion succeeds. On error, restore the backup and retain the rejection
report without retaining rejected bodies outside `.local/`.

The CLI target is
`.local/offline-wiki/imports/<release>/normalized/current.jsonl`; it must reject
an output path outside `.local/offline-wiki/`.

- [ ] **Step 5: Run import tests**

Run: `npx vitest run scripts/offline-wiki/lore/import/canonical.test.ts scripts/offline-wiki/lore/import/transaction.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the canonical importer**

```bash
git add package.json scripts/offline-wiki/lore/import/canonical.ts scripts/offline-wiki/lore/import/canonical.test.ts scripts/offline-wiki/lore/import/transaction.ts scripts/offline-wiki/lore/import/transaction.test.ts scripts/offline-wiki/lore/import/cli.ts
git commit -m "feat: import local lore transactionally"
```

### Task 5: Add saved HoYoWiki and compatible game-data adapters

**Files:**
- Create: `scripts/offline-wiki/lore/import/sanitize-html.ts`
- Create: `scripts/offline-wiki/lore/import/sanitize-html.test.ts`
- Create: `scripts/offline-wiki/lore/import/adapters/hoyowiki.ts`
- Create: `scripts/offline-wiki/lore/import/adapters/hoyowiki.test.ts`
- Create: `scripts/offline-wiki/lore/import/adapters/game-data.ts`
- Create: `scripts/offline-wiki/lore/import/adapters/game-data.test.ts`
- Modify: `scripts/offline-wiki/lore/import/transaction.ts`

**Interfaces:**
- Produces: `convertSavedHoyoWiki(input): CanonicalLoreInput[]`.
- Produces: `convertCompatibleGameData(input): CanonicalLoreInput[]`.
- Consumes: Task 4 canonical input type.

- [ ] **Step 1: Write failing sanitizer tests**

Pass saved HTML containing `script`, `style`, `iframe`, `form`, inline event
handlers, `javascript:` links, remote images, comments, and normal headings and
paragraphs. Assert that only ordered plain-text sections and safe source labels
remain. Assert that no output contains `<`, `>`, `http://`, `https://`, or an
event-handler attribute.

- [ ] **Step 2: Write failing adapter tests with short original fixtures**

For HoYoWiki, cover one aggregate-list JSON fixture and one saved-entry HTML
fixture. Map only manifest-declared entry IDs and require an explicit mapping
file from source category to the approved family/kind.

For game data, cover `ExcelOutput`, `TextMap`, and `Story` fixture directories.
Resolve text-map hashes, preserve dialogue branches, and reject a referenced
hash that is absent rather than substituting an empty string. Detect the source
layout by required filenames declared in the manifest, never by recursively
guessing arbitrary files.

- [ ] **Step 3: Run adapter tests and confirm failure**

Run: `npx vitest run scripts/offline-wiki/lore/import/sanitize-html.test.ts scripts/offline-wiki/lore/import/adapters/hoyowiki.test.ts scripts/offline-wiki/lore/import/adapters/game-data.test.ts`

Expected: FAIL because the sanitizer and adapters are missing.

- [ ] **Step 4: Implement the allowlisted adapters**

Implement the saved-HTML parser without executing scripts or loading resources.
Use explicit tag scanning for headings, paragraphs, list items, and table cells;
decode standard entities and pass every body through a plain-text normalizer.

Implement game-data adapters as small table-specific readers. Each reader
returns canonical entries plus stable rejection records:

```ts
type ImportRejection = {
  sourcePath: string;
  logicalId: string | null;
  reason: "unknown-kind" | "missing-text" | "ambiguous-release" | "malformed-source";
  detail: string;
};
```

Register adapters by the strict manifest enum. No adapter may receive a URL or
network client.

- [ ] **Step 5: Run adapter tests**

Run: `npx vitest run scripts/offline-wiki/lore/import/sanitize-html.test.ts scripts/offline-wiki/lore/import/adapters/hoyowiki.test.ts scripts/offline-wiki/lore/import/adapters/game-data.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the adapters**

```bash
git add scripts/offline-wiki/lore/import
git commit -m "feat: parse user-provided lore exports"
```

### Task 6: Merge lore into the document catalog and produce honest coverage

**Files:**
- Create: `scripts/offline-wiki/lore/coverage.ts`
- Create: `scripts/offline-wiki/lore/coverage.test.ts`
- Create: `scripts/offline-wiki/lore/local-overlay.ts`
- Create: `scripts/offline-wiki/lore/local-overlay.test.ts`
- Modify: `scripts/offline-wiki/catalog.ts`
- Modify: `scripts/offline-wiki/catalog.test.ts`
- Modify: `scripts/offline-wiki/prepare.ts`
- Modify: `scripts/offline-wiki/prepare.test.ts`

**Interfaces:**
- Produces: `LoreCoverageReport` grouped by family and kind.
- Produces: `loadLocalFullTextOverlay(path, releaseId, committedRecords)`.
- Extends: `loadDocumentCatalog` options with committed lore root and optional local overlay path.

- [ ] **Step 1: Write failing local-overlay binding tests**

Assert that a full-text record is admitted only when logical ID, release,
locale, source revision, and source checksum match a committed lore record.
Test unknown IDs, a 4.5 overlay, and source-checksum drift. The absence of the
local overlay path must return an empty map without error.

- [ ] **Step 2: Write failing coverage tests**

For each family/kind assert fields:

```ts
{
  baselineStatus: "complete" | "missing",
  expected: number | null,
  structured: number,
  summaries: number,
  reviewed: number,
  autoGenerated: number,
  fullText: number,
  missingSourceEvidence: number,
  rejectedLaterVersion: number,
  rejectedAmbiguousVersion: number,
  invalidRelationships: number,
  percentage: number | null,
}
```

Assert `percentage: null` whenever `baselineStatus` is `missing`. With a
complete baseline of 4 and two structured records, assert `percentage: 50`.

- [ ] **Step 3: Run catalog and coverage tests and confirm failure**

Run: `npx vitest run scripts/offline-wiki/lore/local-overlay.test.ts scripts/offline-wiki/lore/coverage.test.ts scripts/offline-wiki/catalog.test.ts scripts/offline-wiki/prepare.test.ts`

Expected: FAIL because lore options and coverage fields do not exist.

- [ ] **Step 4: Implement catalog composition and prepare-report schema version 2**

Keep existing character/equipment collections intact. Add `lore` and
`loreCoverage` fields to `DocumentCatalogSchema`. Validate character,
light-cone, and relic relationship targets against the released entity maps.
Match lore summaries from `EditorialData.summaries` by identical logical ID and
require `entityKind: "lore"` before counting them.

Change `PrepareReport.schemaVersion` to 2 and add a `lore` object containing the
four family reports plus totals. Retain existing counts and story-summary gaps
for backward readability. Count rejected records from a local import report
only when the report release matches the build release.

- [ ] **Step 5: Run focused tests**

Run: `npx vitest run scripts/offline-wiki/lore/local-overlay.test.ts scripts/offline-wiki/lore/coverage.test.ts scripts/offline-wiki/catalog.test.ts scripts/offline-wiki/prepare.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit catalog and coverage integration**

```bash
git add scripts/offline-wiki/lore/coverage.ts scripts/offline-wiki/lore/coverage.test.ts scripts/offline-wiki/lore/local-overlay.ts scripts/offline-wiki/lore/local-overlay.test.ts scripts/offline-wiki/catalog.ts scripts/offline-wiki/catalog.test.ts scripts/offline-wiki/prepare.ts scripts/offline-wiki/prepare.test.ts scripts/offline-wiki/schema.ts
git commit -m "feat: report offline lore coverage"
```

### Task 7: Render family indexes, grouped volumes, relationships, and local full text

**Files:**
- Create: `scripts/offline-wiki/render/lore-volumes.ts`
- Create: `scripts/offline-wiki/render/lore-volumes.test.ts`
- Modify: `scripts/offline-wiki/render/volumes.ts`
- Modify: `scripts/offline-wiki/render/html.ts`
- Modify: `scripts/offline-wiki/render/html.test.ts`
- Modify: `scripts/offline-wiki/render/styles.ts`
- Modify: `scripts/offline-wiki/build-html.ts`
- Modify: `scripts/offline-wiki/build-html.test.ts`

**Interfaces:**
- Produces: `renderLoreVolumes(input): RenderedVolume[]`.
- Consumes: composed document catalog, coverage report, and verified local overlay.

- [ ] **Step 1: Write failing grouping and filename tests**

With one fixture record per family, expect these deterministic index files:

```ts
[
  "04-差分宇宙-索引.html",
  "05-世界观-索引.html",
  "06-剧情-索引.html",
  "07-文本收藏-索引.html",
]
```

Expect subgroup files such as `04-差分宇宙-方程-001.html` and
`06-剧情-同行任务-001.html`. Sort by explicit order, then Chinese name, then
logical ID. Split after 200 entries so filenames are stable and no page-count
feedback loop changes grouping.

- [ ] **Step 2: Write failing relationship and fallback tests**

Assert that a mission links to its location and featured character anchors.
When no local overlay exists, assert the summary plus `本地全文未导入`. When a
matching overlay exists, assert ordered section titles, speakers, branch labels,
escaped body text, and `全文来自用户提供的本地资料；未上传 GitHub`.

Also assert that the global index shows baseline status and coverage without a
percentage when the baseline is missing.

- [ ] **Step 3: Run render tests and confirm failure**

Run: `npx vitest run scripts/offline-wiki/render/lore-volumes.test.ts scripts/offline-wiki/render/html.test.ts scripts/offline-wiki/build-html.test.ts`

Expected: FAIL because lore renderers and the new volumes are absent.

- [ ] **Step 4: Implement focused family renderers**

Keep character/equipment rendering in `volumes.ts`. Move lore-specific index,
subgroup, mechanics, relationship, and full-text rendering to
`lore-volumes.ts`. Use only `escapeHtml`, `textToHtml`, and prevalidated
relationships. Render missing baselines and rejected counts prominently.

Update the HTML header language so it distinguishes reviewed summaries,
auto-generated summaries, and user-local full text instead of saying every
story is human-reviewed.

Pass `loreRoot` and optional `localOverlayPath` through `BuildHtmlOptions`.
Default production paths are the committed lore root and
`.local/offline-wiki/imports/<release>/normalized/current.jsonl`.

- [ ] **Step 5: Run rendering tests**

Run: `npx vitest run scripts/offline-wiki/render/lore-volumes.test.ts scripts/offline-wiki/render/html.test.ts scripts/offline-wiki/build-html.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the renderer task**

```bash
git add scripts/offline-wiki/render scripts/offline-wiki/build-html.ts scripts/offline-wiki/build-html.test.ts
git commit -m "feat: render offline lore volumes"
```

### Task 8: Make PDF manifests and verification support deterministic dynamic volumes

**Files:**
- Modify: `scripts/offline-wiki/build.ts`
- Modify: `scripts/offline-wiki/verify.ts`
- Modify: `scripts/offline-wiki/verify.test.ts`
- Modify: `scripts/offline-wiki/pdf/render.test.ts`

**Interfaces:**
- Changes: `BuildManifest.schemaVersion` from 1 to 2.
- Adds: each output's `family`, `group`, and stable `order` metadata.
- Preserves: checksums, page counts, PDF header checks, and zero-network rendering.

- [ ] **Step 1: Write a failing manifest test for dynamic lore outputs**

Build with fixture lore and assert that the manifest starts with the existing
four core volumes plus the global index and then contains the four family
indexes and subgroup PDFs in renderer order. Verify that the manifest does not
accept a PDF filename absent from the HTML inputs.

- [ ] **Step 2: Add failing corruption and remote-request tests**

Corrupt a subgroup PDF and assert checksum failure. Remove one family index and
assert completeness failure. Render local full text containing an escaped
remote image string and assert no request occurs; render deliberately unsafe
raw HTML through the low-level test hook and assert the existing request blocker
fails with the requested URL.

- [ ] **Step 3: Run PDF tests and confirm failure**

Run: `npx vitest run scripts/offline-wiki/verify.test.ts scripts/offline-wiki/pdf/render.test.ts`

Expected: FAIL because verification still expects five fixed PDF names.

- [ ] **Step 4: Implement manifest version 2 and derived verification**

Derive expected PDF names from the ordered HTML inputs and require one matching
PDF per input. Require exactly one global index, the three existing entity
volumes, and one index for each lore family. Permit any number of deterministic
subgroup files. Reject duplicate filenames, order gaps, mismatched family
metadata, and path separators.

- [ ] **Step 5: Run PDF tests**

Run: `npx vitest run scripts/offline-wiki/verify.test.ts scripts/offline-wiki/pdf/render.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit PDF verification changes**

```bash
git add scripts/offline-wiki/build.ts scripts/offline-wiki/verify.ts scripts/offline-wiki/verify.test.ts scripts/offline-wiki/pdf/render.test.ts
git commit -m "feat: verify grouped lore PDFs"
```

### Task 9: Add a source-candidate ledger and admit only proven 4.4 public records

**Files:**
- Create: `scripts/offline-wiki/lore/candidates.ts`
- Create: `scripts/offline-wiki/lore/candidates.test.ts`
- Create: `data/offline-wiki/lore/4.4-cn-2026-08-21/candidates.json`
- Create: `data/offline-wiki/lore/4.4-cn-2026-08-21/rejections.json`
- Modify: `data/offline-wiki/lore/4.4-cn-2026-08-21/baselines.json`
- Modify: the four production lore JSON files only when entry-level 4.4 evidence passes.

**Interfaces:**
- Produces: `evaluateLoreCandidates(candidates, evidence): CandidateDecision[]`.
- Decision states: `admit`, `reject-later-version`, `reject-ambiguous-version`, and `missing-source`.

- [ ] **Step 1: Write failing evidence-decision tests**

Test that an official current directory candidate without historical evidence
becomes `reject-ambiguous-version`, a record first released in 4.5 becomes
`reject-later-version`, and a record tied to an immutable 4.4-compatible
revision plus matching checksum becomes `admit`. Assert that only `admit`
records can be converted to `LoreRecord` inputs.

- [ ] **Step 2: Run the candidate test and confirm failure**

Run: `npx vitest run scripts/offline-wiki/lore/candidates.test.ts`

Expected: FAIL because the evidence evaluator is missing.

- [ ] **Step 3: Implement deterministic admission decisions**

Model evidence as exact release IDs, immutable revision/capture IDs, release
dates, source paths, and checksums. Compare semantic release numbers and the
fixed 4.4 release end boundary already recorded in the repository audit. Never
use entry ID ordering as release evidence.

Populate the candidate ledger from official public directory names and URLs
without copying long bodies. Record one decision per candidate. Admit short
mechanics, factual metadata, and original summaries only after entry-level 4.4
evidence passes. Leave each family baseline `missing` until the candidate set is
proven exhaustive; do not replace missing counts with the number admitted.

- [ ] **Step 4: Validate each family independently**

Run: `npx tsx scripts/offline-wiki/lore/candidates.ts --release 4.4-cn-2026-08-21 --family divergent-universe`

Expected: exit 0 with every candidate assigned exactly one decision and zero
admitted records lacking source revision/checksum.

Repeat with `worldview`, `mission`, and `collectible`; expect the same invariant.

- [ ] **Step 5: Run candidate and catalog tests**

Run: `npx vitest run scripts/offline-wiki/lore/candidates.test.ts scripts/offline-wiki/lore/catalog.test.ts scripts/offline-wiki/lore/coverage.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit the evidence ledger and proven records**

```bash
git add scripts/offline-wiki/lore/candidates.ts scripts/offline-wiki/lore/candidates.test.ts data/offline-wiki/lore/4.4-cn-2026-08-21
git commit -m "data: add sourced 4.4 lore records"
```

### Task 10: Document the workflow and verify the complete repository

**Files:**
- Modify: `docs/offline-wiki.md`
- Modify: `docs/data-sources.md`
- Modify: `README.md`

**Interfaces:**
- Documents: source preparation, manifest generation, import, coverage, HTML/PDF build, verification, and release updates.

- [ ] **Step 1: Write exact user workflows**

Document these two paths:

```bash
# Public summary-only build
npm run docs:prepare -- --release 4.4-cn-2026-08-21
npm run docs:html -- --release 4.4-cn-2026-08-21
npm run docs:build -- --release 4.4-cn-2026-08-21
npm run docs:verify -- --release 4.4-cn-2026-08-21

# User-local full-text build
npm run docs:import-lore -- --release 4.4-cn-2026-08-21 --manifest /absolute/path/manifest.json --source-root /absolute/path/source
npm run docs:prepare -- --release 4.4-cn-2026-08-21
npm run docs:build -- --release 4.4-cn-2026-08-21
npm run docs:verify -- --release 4.4-cn-2026-08-21
```

Explain the canonical JSONL fields, supported adapters, 16 MiB per-file and
512 MiB batch limits, rollback behavior, `baselineStatus`, and why current
HoYoWiki counts cannot establish a 4.4 baseline.

- [ ] **Step 2: Run focused offline-Wiki tests**

Run: `npx vitest run scripts/offline-wiki`

Expected: all offline-Wiki tests PASS.

- [ ] **Step 3: Run repository hygiene and full validation**

Run: `npm run docs:verify:repository`

Expected: PASS and no tracked `.local/offline-wiki/` path.

Run: `npm run check`

Expected: secret scan, typecheck, lint, all Vitest files, data validation, and
production Vite build PASS.

- [ ] **Step 4: Build and verify the 4.4 summary-only documents**

Run:

```bash
npm run docs:prepare -- --release 4.4-cn-2026-08-21
npm run docs:html -- --release 4.4-cn-2026-08-21
npm run docs:build -- --release 4.4-cn-2026-08-21
npm run docs:verify -- --release 4.4-cn-2026-08-21
```

Expected: the global index, existing entity volumes, four lore-family indexes,
all non-empty subgroup PDFs, and a manifest-v2 verification report are created
under `.local/offline-wiki/builds/4.4-cn-2026-08-21/`. Families without a proven
baseline display `基准未建立`; entries without a local overlay display
`本地全文未导入`.

- [ ] **Step 5: Verify no unrelated or local files are staged**

Run: `git status --short`

Expected: no `.local/offline-wiki/` files are listed; the three pre-existing
Buff export files remain untracked and unstaged.

- [ ] **Step 6: Commit documentation**

```bash
git add README.md docs/offline-wiki.md docs/data-sources.md package.json
git commit -m "docs: document local lore imports"
```

Do not push or create a pull request until the user explicitly requests it.
