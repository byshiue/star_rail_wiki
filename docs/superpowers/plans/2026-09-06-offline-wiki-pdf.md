# Offline Wiki PDF Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reproducible local pipeline that turns pinned Star Rail release data plus reviewed original summaries and locally cached artwork into five versioned offline PDF volumes.

**Architecture:** A document-only TypeScript pipeline reads existing release JSON, validates committed metadata with Zod, emits a deterministic normalized catalog, renders print HTML, and drives a local Playwright/Chromium PDF pass. Official binary assets, drafts, HTML intermediates, and PDFs stay under an ignored `.local/offline-wiki` tree; CI validates fixtures and repository hygiene only.

**Tech Stack:** Node.js 24, TypeScript 7, Zod 4, Vitest 4, Playwright 1.62, HTML/CSS print layout.

**Spec:** `docs/superpowers/specs/2026-09-06-offline-wiki-pdf-design.md`

## Global Constraints

- Work on `main` as previously requested; do not create a worktree.
- Use only released, pinned source bundles for formal numeric content.
- Do not commit generated PDFs, downloaded official artwork, source caches, credentials, account data, or unreviewed Agent drafts.
- Story text committed to the repository must be an original human-reviewed summary with provenance.
- Formal builds fail closed for missing core data, release identity, provenance, and checksum mismatch.
- Asset downloads use manifest-listed HTTPS URLs, an allowlist, redirect revalidation, media-type limits, and byte limits.
- GitHub Actions never receives an Agent API key and never publishes the full PDFs.

---

### Task 1: Document Core and Prepare Report

**Files:**
- Modify: `.gitignore`
- Modify: `package.json`
- Create: `scripts/offline-wiki/schema.ts`
- Create: `scripts/offline-wiki/catalog.ts`
- Create: `scripts/offline-wiki/prepare.ts`
- Create: `scripts/offline-wiki/catalog.test.ts`
- Create: `scripts/offline-wiki/prepare.test.ts`
- Create: `scripts/offline-wiki/__fixtures__/releases/index.json`
- Create: `scripts/offline-wiki/__fixtures__/releases/4.4-fixture/release.json`
- Create: `scripts/offline-wiki/__fixtures__/releases/4.4-fixture/entities.json`

**Interfaces:**
- Consumes: existing `public/data/releases/<release>/release.json` and `entities.json`.
- Produces: `loadDocumentCatalog(releasesRoot: string, releaseId: string): DocumentCatalog`, `prepareOfflineWiki(options: PrepareOptions): PrepareReport`, and the `docs:prepare` CLI.

- [ ] **Step 1: Write failing catalog tests**

```ts
it("normalizes characters and equipment with release provenance", () => {
  const catalog = loadDocumentCatalog(fixtureRoot, "4.4-fixture");
  expect(catalog.release.id).toBe("4.4-fixture");
  expect(catalog.characters[0]).toMatchObject({ logicalId: "character:1", name: "测试角色" });
  expect(catalog.characters[0]?.provenance[0]?.sourceRevision).toBe("abcdef12");
});

it("rejects formal entities without provenance", () => {
  expect(() => loadDocumentCatalog(invalidFixtureRoot, "4.4-fixture")).toThrow(/provenance/i);
});
```

- [ ] **Step 2: Run the catalog test and verify RED**

Run: `npx vitest run scripts/offline-wiki/catalog.test.ts`

Expected: FAIL because `loadDocumentCatalog` does not exist.

- [ ] **Step 3: Implement the schemas and catalog loader**

Define `Provenance`, `DocumentCharacter`, `DocumentEquipment`, `DocumentCatalog`, and strict Zod parsing. Split equipment by `logicalId` prefix into light cones and relic sets, preserve original text, sort with `localeCompare("zh-CN")`, and reject missing release/source metadata.

- [ ] **Step 4: Run catalog tests and verify GREEN**

Run: `npx vitest run scripts/offline-wiki/catalog.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing prepare-report tests**

```ts
it("writes a deterministic coverage report under the local output root", () => {
  const report = prepareOfflineWiki({ releasesRoot: fixtureRoot, releaseId: "4.4-fixture", outputRoot });
  expect(report.counts).toEqual({ characters: 1, lightCones: 1, relicSets: 1, divergentUniverse: 0 });
  expect(JSON.parse(readFileSync(join(outputRoot, "builds/4.4-fixture/prepare-report.json"), "utf8"))).toEqual(report);
});
```

- [ ] **Step 6: Run the prepare test and verify RED**

Run: `npx vitest run scripts/offline-wiki/prepare.test.ts`

Expected: FAIL because `prepareOfflineWiki` does not exist.

- [ ] **Step 7: Implement prepare report, CLI, ignore rule, and npm script**

Implement exact-release lookup, atomic JSON report writing, the default `.local/offline-wiki` output, `--release` parsing, and nonzero exit errors. Add `.local/offline-wiki/` to `.gitignore` and `"docs:prepare": "tsx scripts/offline-wiki/prepare.ts"` to `package.json`.

- [ ] **Step 8: Verify Task 1**

Run: `npx vitest run scripts/offline-wiki/catalog.test.ts scripts/offline-wiki/prepare.test.ts && npm run docs:prepare -- --release 4.4-cn-2026-08-21`

Expected: tests PASS and `.local/offline-wiki/builds/4.4-cn-2026-08-21/prepare-report.json` reports 95 characters, 165 light cones, 60 relic sets, and zero Divergent Universe entries.

- [ ] **Step 9: Commit Task 1**

```bash
git add .gitignore package.json package-lock.json scripts/offline-wiki docs/superpowers
git commit -m "feat: add offline wiki document core"
```

### Task 2: Reviewed Summaries and Divergent Universe Schema

**Files:**
- Create: `data/offline-wiki/summaries/characters.json`
- Create: `data/offline-wiki/summaries/light-cones.json`
- Create: `data/offline-wiki/summaries/relics.json`
- Create: `data/offline-wiki/divergent-universe/entries.json`
- Create: `scripts/offline-wiki/editorial.ts`
- Create: `scripts/offline-wiki/editorial.test.ts`
- Modify: `scripts/offline-wiki/catalog.ts`

**Interfaces:**
- Consumes: `ReviewedSummarySchema`, `DivergentUniverseEntrySchema`, and committed JSON files.
- Produces: `loadEditorialData(root: string): EditorialData` and catalog-level `summaryCoverage`.

- [ ] **Step 1: Write failing editorial validation tests**

```ts
it("admits only reviewed original summaries", () => {
  expect(() => parseSummary({ ...baseSummary, status: "draft" })).toThrow(/reviewed/i);
  expect(parseSummary({ ...baseSummary, status: "reviewed" }).logicalId).toBe("character:1");
});

it("requires attributable Divergent Universe records", () => {
  expect(() => parseDivergentUniverseEntry({ ...baseEntry, provenance: [] })).toThrow(/provenance/i);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npx vitest run scripts/offline-wiki/editorial.test.ts`

Expected: FAIL because the parsers do not exist.

- [ ] **Step 3: Implement strict editorial loaders and seed empty reviewed collections**

Use discriminated entity kinds, require `locale: "zh-CN"`, `status: "reviewed"`, ISO review timestamps, nonempty reviewer labels, nonempty source lists, and SHA-256 content checksums. Add a single clearly labeled reviewed fixture-style Divergent Universe sample only when its real released source is pinned and cited.

- [ ] **Step 4: Verify Task 2**

Run: `npx vitest run scripts/offline-wiki/editorial.test.ts scripts/offline-wiki/catalog.test.ts`

Expected: PASS; unreviewed or unattributed content fails validation.

- [ ] **Step 5: Commit Task 2**

```bash
git add data/offline-wiki scripts/offline-wiki
git commit -m "feat: add reviewed offline wiki editorial data"
```

### Task 3: Deterministic HTML Volumes

**Files:**
- Create: `scripts/offline-wiki/render/html.ts`
- Create: `scripts/offline-wiki/render/volumes.ts`
- Create: `scripts/offline-wiki/render/styles.ts`
- Create: `scripts/offline-wiki/render/html.test.ts`
- Create: `scripts/offline-wiki/build-html.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `DocumentCatalog` and `EditorialData`.
- Produces: `renderVolumes(input: VolumeRenderInput): RenderedVolume[]`, where every volume has `filename`, `title`, and complete HTML.

- [ ] **Step 1: Write failing render tests**

```ts
it("renders five ordered A4 volumes with release and provenance labels", () => {
  const volumes = renderVolumes(fixtureInput);
  expect(volumes.map((volume) => volume.filename)).toEqual([
    "00-总索引.html", "01-角色图鉴.html", "02-光锥图鉴.html", "03-遗器图鉴.html", "04-差分宇宙图鉴.html",
  ]);
  expect(volumes[1]?.html).toContain("@page { size: A4");
  expect(volumes[1]?.html).toContain("fixture-revision");
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npx vitest run scripts/offline-wiki/render/html.test.ts`

Expected: FAIL because `renderVolumes` does not exist.

- [ ] **Step 3: Implement escaping, stable anchors, sections, navigation, and print CSS**

Render standalone UTF-8 documents without client JavaScript. Escape all source content, generate deterministic anchors from logical IDs, add multi-level contents, return links, release headers, source footers, explicit missing-summary/image labels, page-break controls, and `@page` A4 rules.

- [ ] **Step 4: Add CLI and verify Task 3**

Run: `npx vitest run scripts/offline-wiki/render/html.test.ts && npm run docs:html -- --release 4.4-cn-2026-08-21`

Expected: PASS and five HTML files are written below the ignored release build directory.

- [ ] **Step 5: Commit Task 3**

```bash
git add package.json package-lock.json scripts/offline-wiki
git commit -m "feat: render offline wiki HTML volumes"
```

### Task 4: Safe Local Artwork Cache

**Files:**
- Create: `data/offline-wiki/assets.json`
- Create: `scripts/offline-wiki/assets/manifest.ts`
- Create: `scripts/offline-wiki/assets/download.ts`
- Create: `scripts/offline-wiki/assets/download.test.ts`
- Create: `scripts/offline-wiki/assets-cli.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: committed `AssetManifestEntry[]` and injected `fetch` for tests.
- Produces: `downloadAssets(options: DownloadAssetsOptions): Promise<AssetReport>` and cached files keyed by content checksum.

- [ ] **Step 1: Write failing downloader security tests**

```ts
it.each(["http://example.com/a.png", "https://unlisted.example/a.png"])("rejects unsafe source %s", async (url) => {
  await expect(downloadAsset({ ...baseAsset, url }, options)).rejects.toThrow(/allowlist|https/i);
});

it("revalidates redirect hosts and rejects oversized or mismatched content", async () => {
  await expect(downloadAsset(baseAsset, redirectingOptions)).rejects.toThrow(/redirect host/i);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npx vitest run scripts/offline-wiki/assets/download.test.ts`

Expected: FAIL because the downloader does not exist.

- [ ] **Step 3: Implement manifest validation and streaming bounded download**

Require HTTPS, exact allowlisted hosts, maximum redirects, redirect revalidation, `image/png`, `image/jpeg`, or `image/webp`, an explicit byte ceiling, SHA-256 verification when declared, temporary-file cleanup, and atomic cache promotion.

- [ ] **Step 4: Verify Task 4**

Run: `npx vitest run scripts/offline-wiki/assets/download.test.ts`

Expected: PASS without contacting the network.

- [ ] **Step 5: Commit Task 4**

```bash
git add data/offline-wiki/assets.json package.json package-lock.json scripts/offline-wiki/assets scripts/offline-wiki/assets-cli.ts
git commit -m "feat: add safe local wiki artwork cache"
```

### Task 5: Local Draft Review Workflow

**Files:**
- Create: `scripts/offline-wiki/review/drafts.ts`
- Create: `scripts/offline-wiki/review/server.ts`
- Create: `scripts/offline-wiki/review/page.ts`
- Create: `scripts/offline-wiki/review/drafts.test.ts`
- Create: `scripts/offline-wiki/draft.ts`
- Create: `scripts/offline-wiki/review.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: local draft JSON and committed source references.
- Produces: loopback-only review endpoints and an explicitly promoted `ReviewedSummary` JSON record.

- [ ] **Step 1: Write failing promotion and binding tests**

```ts
it("refuses promotion without an explicit reviewed decision", () => {
  expect(() => promoteDraft(baseDraft, { decision: "reject" })).toThrow(/accept/i);
});

it("binds the review server to loopback only", async () => {
  const server = await startReviewServer({ host: "127.0.0.1", port: 0, draftsRoot });
  expect(server.address().address).toBe("127.0.0.1");
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npx vitest run scripts/offline-wiki/review/drafts.test.ts`

Expected: FAIL because promotion and server functions do not exist.

- [ ] **Step 3: Implement local draft envelopes, review UI, and explicit promotion**

Keep draft generation provider-neutral and local. Require the user to review editable summary text alongside source links, record the decision and reviewer label, recompute the content checksum, and write only the selected record. Never read credentials from committed files or expose the server beyond `127.0.0.1`.

- [ ] **Step 4: Verify Task 5**

Run: `npx vitest run scripts/offline-wiki/review/drafts.test.ts`

Expected: PASS; rejected and untouched drafts cannot become reviewed records.

- [ ] **Step 5: Commit Task 5**

```bash
git add package.json package-lock.json scripts/offline-wiki/review scripts/offline-wiki/draft.ts scripts/offline-wiki/review.ts
git commit -m "feat: add local story summary review workflow"
```

### Task 6: PDF Rendering and Verification

**Files:**
- Create: `scripts/offline-wiki/pdf/render.ts`
- Create: `scripts/offline-wiki/pdf/inspect.ts`
- Create: `scripts/offline-wiki/pdf/render.test.ts`
- Create: `scripts/offline-wiki/build.ts`
- Create: `scripts/offline-wiki/verify.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: five rendered HTML files, approved local assets, and an installed Playwright Chromium.
- Produces: five named PDFs and `build-manifest.json` containing release ID, input checksums, outputs, page counts, and verification results.

- [ ] **Step 1: Write failing orchestration tests with an injected PDF renderer**

```ts
it("renders exactly five PDFs and records their checksums", async () => {
  const manifest = await buildOfflineWiki({ ...fixtureOptions, renderPdf: fakeRenderer });
  expect(manifest.outputs.map((output) => output.filename)).toEqual([
    "00-总索引.pdf", "01-角色图鉴.pdf", "02-光锥图鉴.pdf", "03-遗器图鉴.pdf", "04-差分宇宙图鉴.pdf",
  ]);
  expect(manifest.outputs.every((output) => output.checksum.startsWith("sha256:"))).toBe(true);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npx vitest run scripts/offline-wiki/pdf/render.test.ts`

Expected: FAIL because build orchestration does not exist.

- [ ] **Step 3: Implement Playwright PDF output and manifest generation**

Load local HTML with JavaScript disabled, wait for local fonts and images, use A4 with CSS page sizes and backgrounds, generate deterministic metadata, checksum each input/output, and refuse remote subresources. Keep the renderer injectable so unit tests do not require Chromium.

- [ ] **Step 4: Implement verification gates**

Validate five outputs, nonzero page counts, expected titles/bookmark outline where the PDF backend supports it, internal links, embedded Chinese font resources, formal-entry provenance, absence of drafts, and absence of tracked `.local/offline-wiki` files.

- [ ] **Step 5: Verify Task 6**

Run: `npx vitest run scripts/offline-wiki/pdf/render.test.ts && npm run docs:build -- --release 4.4-cn-2026-08-21 && npm run docs:verify -- --release 4.4-cn-2026-08-21`

Expected: tests PASS; local Chromium produces and verifies five PDFs. If Chromium is not installed, the CLI exits with a specific installation instruction and the unit suite remains green.

- [ ] **Step 6: Commit Task 6**

```bash
git add package.json package-lock.json scripts/offline-wiki
git commit -m "feat: build and verify offline wiki PDFs"
```

### Task 7: CI, Documentation, and Repository Hygiene

**Files:**
- Create: `.github/workflows/offline-wiki.yml`
- Create: `scripts/offline-wiki/repository-hygiene.ts`
- Create: `scripts/offline-wiki/repository-hygiene.test.ts`
- Create: `docs/offline-wiki.md`
- Modify: `README.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: committed manifests, schemas, tests, and Git tracked-file list.
- Produces: `docs:verify:repository`, a validation-only CI job, and operator documentation.

- [ ] **Step 1: Write failing hygiene tests**

```ts
it.each([".local/offline-wiki/builds/4.4/book.pdf", ".local/offline-wiki/assets/a.webp", ".local/offline-wiki/drafts/a.json"])(
  "rejects tracked local artifact %s",
  (path) => expect(validateTrackedFiles([path])).toContain(path),
);
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npx vitest run scripts/offline-wiki/repository-hygiene.test.ts`

Expected: FAIL because the validator does not exist.

- [ ] **Step 3: Implement hygiene validation and CI**

Use `git ls-files` input, reject local output paths and prohibited binary extensions under offline-wiki data, run schemas/render fixtures/hygiene/secret checks in CI, and omit Agent calls, network asset downloads, and full PDF generation.

- [ ] **Step 4: Document clean-machine setup and version updates**

Document prerequisites, local-only boundaries, exact commands, source review, summary approval, image rights caveat, PDF archive layout, troubleshooting, and the fact that HoYoWiki is not mirrored.

- [ ] **Step 5: Run final verification**

Run: `npm run scan:secrets && npm run typecheck && npm run lint && npm test && npm run validate:data && npm run build && npm run docs:verify:repository`

Expected: all commands PASS. Run the local PDF smoke separately when Chromium and allowed assets are available.

- [ ] **Step 6: Commit Task 7**

```bash
git add .github/workflows/offline-wiki.yml docs/offline-wiki.md README.md package.json package-lock.json scripts/offline-wiki
git commit -m "docs: document and validate offline wiki workflow"
```
