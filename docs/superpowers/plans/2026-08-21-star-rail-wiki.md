# Star Rail Wiki Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and publish a versioned Simplified Chinese Honkai: Star Rail wiki, buff/team simulator, explainable recommendation agent, sourced community-team library, and isolated multi-UID account profiles.

**Architecture:** A React/TypeScript/Vite static application reads immutable, generated JSON releases and runs search, effect evaluation, recommendations, and IndexedDB profile storage in the browser. Node scripts import allowlisted released-game data, apply reviewed effect overlays, emit completeness/version-diff reports, and validate public UID profiles; GitHub Actions reviews updates and deploys verified `main` builds to GitHub Pages.

**Tech Stack:** Node.js 24 LTS, npm, React 19.2, TypeScript 7, Vite 8, React Router 7 hash routing, Zod 4, IndexedDB through `idb`, Vitest, Testing Library, Playwright, GitHub Actions, GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-08-21-star-rail-wiki-design.md`

## Global Constraints

- Product language is Simplified Chinese.
- Import Mainland China released-channel data only; reject beta, preload, leaked, and unreleased records.
- Every entity revision and every simulator/recommendation result pins a `DataRelease.id` and upstream provenance.
- Complete source descriptions remain visible even when an effect cannot yet be evaluated.
- A numeric buff or debuff must be reviewed or explicitly marked unsupported; it may never disappear silently.
- Core team recommendations must work without an API key and must be deterministic for identical input and release data.
- Profiles are isolated by UID in IndexedDB and private by default.
- Publishing a UID profile requires explicit public-consent metadata and repository review; the browser never stores GitHub credentials.
- GitHub Pages production base path is `/star_rail_wiki/` and shared routes must survive refreshes.
- Preserve third-party provenance and do not vendor assets or data until their licenses have been audited.
- Use Node.js `24.x`; commit `package-lock.json` and use `npm ci` in automation.

---

## Planned file structure

```text
.
├── .github/workflows/
│   ├── ci.yml                    # PR and main validation
│   ├── deploy-pages.yml          # Pages build and publish
│   └── sync-game-data.yml        # reviewed scheduled data-update PR
├── data/
│   ├── manual/effects.json       # reviewed parser overlays
│   ├── community/teams.json      # sourced team presets
│   └── fixtures/release-4.3/     # small reviewed golden fixture
├── docs/
│   ├── data-sources.md
│   ├── profile-publication.md
│   └── superpowers/              # approved design and implementation plan
├── public/
│   ├── data/releases/            # generated immutable site payloads
│   └── profiles/                 # explicitly public UID JSON files
├── scripts/
│   ├── game-data/                # source fetch, parse, release guard, diff
│   ├── validate-public-profiles.ts
│   └── validate-repository.ts
├── src/
│   ├── app/                      # shell, router, providers
│   ├── domain/                   # schemas and shared types
│   ├── data/                     # browser release repository
│   ├── effects/                  # normalized evaluator
│   ├── wiki/                     # searchable reference UI
│   ├── simulator/                # team state and result UI
│   ├── recommendations/          # deterministic agent
│   ├── community/                # sourced presets
│   ├── profiles/                 # IndexedDB import/export/publish flow
│   └── styles/                   # tokens and responsive layout
├── tests/e2e/                    # Playwright user flows
└── package.json                  # reproducible scripts and dependencies
```

---

### Task 1: Reproducible application and GitHub Pages shell

**Files:**
- Create: `package.json`
- Create: `package-lock.json`
- Create: `tsconfig.json`
- Create: `vite.config.ts`
- Create: `vitest.config.ts`
- Create: `playwright.config.ts`
- Create: `eslint.config.js`
- Create: `index.html`
- Create: `src/main.tsx`
- Create: `src/app/App.tsx`
- Create: `src/app/routes.tsx`
- Create: `src/styles/tokens.css`
- Create: `src/styles/app.css`
- Create: `src/app/App.test.tsx`
- Create: `scripts/validate-repository.ts`
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Produces: `App(): JSX.Element`; `appRoutes: RouteObject[]`; npm scripts `dev`, `build`, `typecheck`, `lint`, `test`, `test:e2e`, `validate:data`, and `check`.

- [ ] **Step 1: Write the failing shell test**

```tsx
import { render, screen } from "@testing-library/react";
import { App } from "./App";

test("renders the six primary areas", () => {
  render(<App />);
  for (const label of ["资料库", "角色构筑", "配队实验室", "Agent 推荐", "社区配队", "账号与版本"]) {
    expect(screen.getByRole("link", { name: label })).toBeInTheDocument();
  }
});
```

- [ ] **Step 2: Install the pinned toolchain and verify the test fails**

Run:

```bash
npm install --save-exact react@19.2.7 react-dom@19.2.7 react-router-dom@7.18.0 zod@4 idb@8
npm install --save-dev --save-exact typescript@7.0.2 vite@8.2.1 @vitejs/plugin-react eslint vitest jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event @types/react @types/react-dom @playwright/test tsx
npm test -- src/app/App.test.tsx
```

Expected: FAIL because `App` does not exist.

- [ ] **Step 3: Implement the minimal accessible hash-routed shell**

```tsx
export function App() {
  return (
    <HashRouter>
      <a className="skip-link" href="#main">跳到主要内容</a>
      <AppNavigation />
      <main id="main"><Routes>{/* one route per approved primary area */}</Routes></main>
    </HashRouter>
  );
}
```

Set `vite.config.ts` to `base: "/star_rail_wiki/"`, add semantic navigation and responsive design tokens, and make placeholder routes state their exact upcoming purpose without fabricated game data.
Create the initial repository validator so the Task 1 `check` command is real before game data exists:

```ts
export async function validateRepository(): Promise<void> {
  return Promise.resolve();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await validateRepository();
}
```


- [ ] **Step 4: Add the repository check script and CI workflow**

```json
{
  "scripts": {
    "build": "tsc -b && vite build",
    "typecheck": "tsc -b --pretty false",
    "lint": "eslint .",
    "test": "vitest run",
    "test:e2e": "playwright test",
    "validate:data": "tsx scripts/validate-repository.ts",
    "check": "npm run typecheck && npm run lint && npm test && npm run validate:data && npm run build"
  }
}
```

CI uses `actions/setup-node` with `node-version: 24`, `npm ci`, then `npm run check`.

- [ ] **Step 5: Verify and commit the shell**

Run: `npm run check`

Expected: all shell tests and the production build pass.

```bash
git add package.json package-lock.json tsconfig.json vite.config.ts vitest.config.ts playwright.config.ts eslint.config.js index.html src scripts/validate-repository.ts .github/workflows/ci.yml
git commit -m "feat: scaffold star rail wiki shell"
```

---

### Task 2: Versioned domain schemas and release repository

**Files:**
- Create: `src/domain/releases.ts`
- Create: `src/domain/entities.ts`
- Create: `src/domain/effects.ts`
- Create: `src/domain/profiles.ts`
- Create: `src/domain/community.ts`
- Create: `src/domain/schemas.test.ts`
- Create: `src/data/releaseRepository.ts`
- Create: `src/data/releaseRepository.test.ts`
- Create: `data/fixtures/release-4.3/release.json`
- Create: `data/fixtures/release-4.3/entities.json`
- Create: `public/data/releases/index.json`
- Create: `public/data/releases/4.3-fixture/release.json`
- Create: `public/data/releases/4.3-fixture/entities.json`

**Interfaces:**
- Produces: `DataReleaseSchema`, `CharacterRevisionSchema`, `EquipmentRevisionSchema`, `EffectSchema`, `AccountProfileSchema`, `TeamPresetSchema`.
- Produces: `loadReleaseIndex(): Promise<ReleaseIndex>` and `loadRelease(id: string): Promise<GameReleaseBundle>`.

- [ ] **Step 1: Write failing schema tests for provenance and immutable revisions**

```ts
it("rejects an entity revision without source provenance", () => {
  expect(() => CharacterRevisionSchema.parse({ id: "char:1001@4.3" })).toThrow();
});

it("accepts a reviewed released-channel fixture", () => {
  expect(DataReleaseSchema.parse(releaseFixture).channel).toBe("released");
  expect(releaseFixture.sources[0].revision).toMatch(/^[a-f0-9]{8,40}$/);
});
```

- [ ] **Step 2: Run the schema tests to verify they fail**

Run: `npm test -- src/domain/schemas.test.ts`

Expected: FAIL because schemas are missing.

- [ ] **Step 3: Implement the exact shared domain contracts**

```ts
export type ReviewStatus = "generated" | "reviewed" | "unsupported";
export type EntityKind = "character" | "ability" | "eidolon" | "light-cone" | "relic-set";

export interface EntityProvenance {
  sourceName: string;
  sourceUrl: string;
  sourceRevision: string;
  sourcePath: string;
  sourceChecksum: string;
}

export interface RevisionIdentity {
  logicalId: string;
  revisionId: string;
  validFromReleaseId: string;
  validToReleaseId: string | null;
  provenance: EntityProvenance[];
}
```

Implement Zod schemas as the runtime authority and infer exported TypeScript types from them.

- [ ] **Step 4: Implement a release repository that validates before returning data**

```ts
export async function loadRelease(id: string): Promise<GameReleaseBundle> {
  const base = `${import.meta.env.BASE_URL}data/releases/${encodeURIComponent(id)}`;
  const [release, entities] = await Promise.all([
    fetchJson(`${base}/release.json`),
    fetchJson(`${base}/entities.json`),
  ]);
  return GameReleaseBundleSchema.parse({ release, entities });
}
```

- [ ] **Step 5: Verify the fixture and repository, then commit**

Run: `npm test -- src/domain src/data`

Expected: PASS, including a mocked fetch that rejects malformed release data.

```bash
git add src/domain src/data data/fixtures public/data/releases
git commit -m "feat: add versioned game data schemas"
```

---

### Task 3: Released-channel importer, provenance, and version diffs

**Files:**
- Create: `scripts/game-data/sourceManifest.ts`
- Create: `scripts/game-data/fetchSource.ts`
- Create: `scripts/game-data/releaseGuard.ts`
- Create: `scripts/game-data/importStarRailRes.ts`
- Create: `scripts/game-data/buildRelease.ts`
- Create: `scripts/game-data/diffReleases.ts`
- Create: `scripts/game-data/importer.test.ts`
- Create: `scripts/game-data/__fixtures__/source/`
- Create: `scripts/game-data/__fixtures__/preload-source/`
- Create: `docs/data-sources.md`

**Interfaces:**
- Consumes: domain Zod schemas from Task 2.
- Produces: `fetchSource(manifest): Promise<FetchedSource>`; `assertReleasedChannel(metadata): void`; `buildRelease(input): Promise<GameReleaseBundle>`; `diffReleases(previous, next): ReleaseDiff`.
- Produces CLI: `npm run data:import -- --version 4.3 --source-revision d5c40c00` for the approved initial manifest.

- [ ] **Step 1: Write failing tests that reject mixed 4.3/4.4 preload input**

```ts
it("rejects a source whose text map is newer than the approved released manifest", async () => {
  await expect(buildRelease(preloadFixture)).rejects.toThrow(/released channel mismatch/i);
});

it("records checksums and upstream paths for every imported revision", async () => {
  const bundle = await buildRelease(releasedFixture);
  expect(bundle.entities.every((entity) => entity.provenance.every((p) => p.sourceChecksum))).toBe(true);
});
```

- [ ] **Step 2: Run importer tests and confirm failure**

Run: `npm test -- scripts/game-data/importer.test.ts`

Expected: FAIL because importer modules are missing.

- [ ] **Step 3: Implement an allowlisted source manifest**

```ts
export const requiredIndexes = [
  "characters",
  "character_ranks",
  "character_skills",
  "character_skill_trees",
  "light_cones",
  "light_cone_ranks",
  "relic_sets",
] as const;

export interface ApprovedSourceManifest {
  gameVersion: string;
  channel: "released";
  revision: string;
  baseUrl: string;
  expectedPaths: readonly string[];
}
```

Require a review-supplied game version and upstream revision; never infer released status from “latest”. Download into a temporary directory, verify HTTP status and SHA-256, then parse.

- [ ] **Step 4: Map upstream indexes to stable revisions and original Chinese descriptions**

Use `index_new/cn/characters.json`, `character_ranks.json`, `character_skills.json`, `character_skill_trees.json`, `light_cones.json`, `light_cone_ranks.json`, and `relic_sets.json`. Preserve source paths and original descriptions. Do not download image trees during this task.

- [ ] **Step 5: Implement field-level release diffs**

```ts
export interface ReleaseDiffEntry {
  logicalId: string;
  kind: "added" | "removed" | "changed";
  changes: Array<{ path: string; before: unknown; after: unknown }>;
}
```

Sort by `logicalId` and field path so repeated imports generate byte-identical output.

- [ ] **Step 6: Verify deterministic import and commit**

Run:

```bash
npm test -- scripts/game-data/importer.test.ts
npm run data:import -- --version 4.3 --source-revision d5c40c00 --output /tmp/star-rail-release-a
npm run data:import -- --version 4.3 --source-revision d5c40c00 --output /tmp/star-rail-release-b
diff -ru /tmp/star-rail-release-a /tmp/star-rail-release-b
npm run data:import -- --version 4.3 --source-revision d5c40c00
```

Expected: tests pass and a second import produces no diff. If 4.3 is no longer the reviewed live version during execution, replace the fixture invocation with the then-approved released manifest and record that decision in `docs/data-sources.md`.

```bash
git add scripts/game-data docs/data-sources.md public/data/releases package.json package-lock.json
git commit -m "feat: import versioned released game data"
```

---

### Task 4: Reviewed effect overlays and completeness gate

**Files:**
- Create: `data/manual/effects.json`
- Create: `scripts/game-data/extractEffects.ts`
- Create: `scripts/game-data/applyEffectOverlays.ts`
- Create: `scripts/game-data/checkEffectCoverage.ts`
- Create: `scripts/game-data/effects.test.ts`
- Create: `public/data/releases/4.3-fixture/effects.json`
- Create: `public/data/releases/4.3-fixture/coverage.json`
- Modify: `scripts/game-data/buildRelease.ts`
- Modify: `scripts/validate-repository.ts`

**Interfaces:**
- Consumes: entity revisions from Task 3.
- Produces: `extractCandidateEffects(entity): CandidateEffect[]`; `applyEffectOverlays(candidates, overlays): Effect[]`; `buildCoverageReport(entities, effects): CoverageReport`.

- [ ] **Step 1: Write failing golden tests for reviewed, generated, and unsupported effects**

```ts
it.each([
  ["team damage bonus", "damage_bonus", "team"],
  ["enemy defense reduction", "defense_reduction", "enemy"],
  ["action advance", "action_advance", "ally"],
])("normalizes %s", (_, metric, target) => {
  const effect = parseGoldenEffect(_);
  expect(effect).toMatchObject({ metric, target: { kind: target }, reviewStatus: "reviewed" });
});

it("fails coverage when numeric buff text has no effect or unsupported record", () => {
  expect(() => assertComplete(unmappedNumericFixture)).toThrow(/unmapped numeric effect/i);
});
```

- [ ] **Step 2: Run the effect tests and confirm failure**

Run: `npm test -- scripts/game-data/effects.test.ts`

Expected: FAIL because the extractor and coverage gate do not exist.

- [ ] **Step 3: Implement conservative candidate extraction**

Detect numeric tokens and an allowlist of buff/debuff phrases only to create candidates. Generated candidates are not equivalent to reviewed effects. Ambiguous scope, duration, target, scaling, or stacking forces a manual overlay or an explicit unsupported entry.

- [ ] **Step 4: Implement stable manual overlays**

```json
{
  "schemaVersion": 1,
  "overlays": [
    {
      "sourceRevisionId": "ability:fixture-support-skill@4.3",
      "reviewStatus": "reviewed",
      "metric": "damage_bonus",
      "operation": "percent",
      "value": { "kind": "constant", "value": 0.5 },
      "target": { "kind": "team" },
      "trigger": { "kind": "after_skill" },
      "duration": { "kind": "turns", "value": 2 },
      "stacking": { "kind": "refresh", "maxStacks": 1 },
      "conditions": []
    }
  ]
}
```

- [ ] **Step 5: Add the repository coverage gate**

Require counts for total source descriptions, candidate numeric effects, reviewed effects, generated effects, explicit unsupported effects, and unmapped effects. Production validation requires `unmappedEffects === 0`.

- [ ] **Step 6: Verify and commit**

Run: `npm test -- scripts/game-data/effects.test.ts && npm run validate:data`

Expected: fixture coverage passes; an intentionally unmapped fixture fails.

```bash
git add data/manual scripts/game-data public/data/releases scripts/validate-repository.ts
git commit -m "feat: add reviewed effect coverage pipeline"
```

---

### Task 5: Searchable wiki and version/source detail views

**Files:**
- Create: `src/wiki/searchIndex.ts`
- Create: `src/wiki/useWikiSearch.ts`
- Create: `src/wiki/WikiPage.tsx`
- Create: `src/wiki/EntityDetailPage.tsx`
- Create: `src/wiki/EffectSourceList.tsx`
- Create: `src/wiki/VersionBadge.tsx`
- Create: `src/wiki/wiki.test.tsx`
- Create: `src/app/ReleaseProvider.tsx`
- Modify: `src/app/routes.tsx`

**Interfaces:**
- Consumes: `loadRelease()` and domain schemas from Task 2.
- Produces: `buildSearchIndex(bundle): WikiSearchIndex`; `searchWiki(index, query, filters): SearchResult[]`.

- [ ] **Step 1: Write failing UI tests for search, full text, and provenance**

```tsx
test("finds a character and shows every effect source with version", async () => {
  renderWiki(fixtureBundle);
  await userEvent.type(screen.getByRole("searchbox", { name: "搜索资料" }), "测试辅助");
  await userEvent.click(screen.getByRole("link", { name: "测试辅助" }));
  expect(screen.getByText("正式服 4.3")).toBeVisible();
  expect(screen.getByRole("link", { name: /资料来源/ })).toHaveAttribute("href", expect.stringMatching(/^https:/));
  expect(screen.getByText(fixtureFullSkillDescription)).toBeVisible();
});
```

- [ ] **Step 2: Run the wiki test and confirm failure**

Run: `npm test -- src/wiki/wiki.test.tsx`

Expected: FAIL because wiki components are missing.

- [ ] **Step 3: Implement normalized search and filters**

Index character/equipment names, effect text, element, path, rarity, and effect metrics. Normalize whitespace and Simplified Chinese punctuation; do not rewrite displayed source text.

- [ ] **Step 4: Implement entity detail and version/source disclosure**

Render complete skills, traces, eidolons, light-cone superimpositions, and set thresholds. Each revision shows its release, review status, upstream source URL/path/revision, and before/after diff link when another revision exists.

- [ ] **Step 5: Verify accessibility and commit**

Run: `npm test -- src/wiki && npm run typecheck`

Expected: search and keyboard navigation pass at fixture scale.

```bash
git add src/wiki src/app/ReleaseProvider.tsx src/app/routes.tsx
git commit -m "feat: add versioned searchable wiki"
```

---

### Task 6: Deterministic buff evaluator

**Files:**
- Create: `src/effects/context.ts`
- Create: `src/effects/conditions.ts`
- Create: `src/effects/targets.ts`
- Create: `src/effects/scaling.ts`
- Create: `src/effects/aggregate.ts`
- Create: `src/effects/evaluateTeam.ts`
- Create: `src/effects/evaluateTeam.test.ts`
- Create: `src/effects/__fixtures__/goldenTeams.ts`

**Interfaces:**
- Produces: `evaluateTeam(build: TeamBuild, scenario: BattleScenario, bundle: GameReleaseBundle): TeamEvaluation`.
- Produces: `TeamEvaluation` with `active`, `conditional`, `inactive`, `unsupported`, `wasted`, and `evidence` collections.

- [ ] **Step 1: Write failing golden tests for operations, conditions, targets, and evidence**

```ts
it("does not naively add damage bonus and vulnerability", () => {
  const result = evaluateTeam(goldenTeam, allConditionsActive, fixtureBundle);
  expect(result.groups.damage_bonus.total).toBe(0.5);
  expect(result.groups.vulnerability.total).toBe(0.2);
});

it("keeps inactive conditional effects and their evidence", () => {
  const result = evaluateTeam(goldenTeam, { enemyBroken: false }, fixtureBundle);
  expect(result.inactive[0]).toMatchObject({ reason: "enemy_not_broken" });
  expect(result.inactive[0].evidence.sourceRevisionId).toBeTruthy();
});
```

- [ ] **Step 2: Run the evaluator tests and confirm failure**

Run: `npm test -- src/effects/evaluateTeam.test.ts`

Expected: FAIL because `evaluateTeam` is missing.

- [ ] **Step 3: Implement legality, condition, target, scaling, and stacking stages**

```ts
export function evaluateEffect(effect: Effect, context: EvaluationContext): EvaluatedEffect {
  const legality = checkSourceLegality(effect, context);
  const condition = evaluateConditions(effect.conditions, context);
  const targets = resolveTargets(effect.target, context);
  const value = resolveScalingValue(effect.value, context);
  return classifyEffect({ effect, legality, condition, targets, value });
}
```

Keep fractional values internally (`0.5` means 50%). Round only in UI formatting.

- [ ] **Step 4: Aggregate only compatible metrics and operations**

Define one reducer per metric/operation pair. Emit warnings for conflicting overrides, exceeded caps, target mismatch, and buffs that no selected character can consume.

- [ ] **Step 5: Add property-style invariants and commit**

Test deterministic ordering, no mutation of inputs, stack caps, zero/negative values, and identical output for equivalent condition ordering.

Run: `npm test -- src/effects`

Expected: all golden and invariant tests pass.

```bash
git add src/effects
git commit -m "feat: evaluate team buffs with evidence"
```

---

### Task 7: Character builder and team simulator UI

**Files:**
- Create: `src/simulator/teamBuild.ts`
- Create: `src/simulator/useTeamBuild.ts`
- Create: `src/simulator/CharacterBuilderPage.tsx`
- Create: `src/simulator/TeamSimulatorPage.tsx`
- Create: `src/simulator/TeamSlots.tsx`
- Create: `src/simulator/ScenarioControls.tsx`
- Create: `src/simulator/EffectSummary.tsx`
- Create: `src/simulator/EvidenceDrawer.tsx`
- Create: `src/simulator/simulator.test.tsx`
- Modify: `src/app/routes.tsx`

**Interfaces:**
- Consumes: `evaluateTeam()` from Task 6.
- Produces: `encodeTeamBuild(build): string`; `decodeTeamBuild(value): TeamBuild`; shareable hash routes pinned to `releaseId`.

- [ ] **Step 1: Write failing interaction tests**

```tsx
test("changing an eidolon recomputes buffs and preserves release provenance", async () => {
  renderSimulator(fixtureBundle);
  await selectTeam(["dps", "support", "support-2", "sustain"]);
  await userEvent.selectOptions(screen.getByLabelText("测试辅助星魂"), "1");
  expect(screen.getByText("全队增伤 +50%")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "查看全队增伤来源" }));
  expect(screen.getByText("正式服 4.3")).toBeVisible();
});
```

- [ ] **Step 2: Run the simulator test and confirm failure**

Run: `npm test -- src/simulator/simulator.test.tsx`

Expected: FAIL because simulator state and UI are missing.

- [ ] **Step 3: Implement validated build state and legal equipment selectors**

Reject duplicate character forms when the game disallows them, incompatible light-cone paths, invalid eidolon/superimposition ranges, and unknown revision IDs.

- [ ] **Step 4: Implement the approved responsive visual layout**

Place four team slots and pinned release beside categorized active/conditional/self/enemy/resource results on desktop; stack them on narrow screens. Native controls manage scenario conditions. Every result button opens a focus-managed evidence drawer.

- [ ] **Step 5: Implement deterministic share URLs and commit**

Encode stable logical IDs and investments, not display names. Decode through Zod and show a recoverable error for stale or malformed URLs.

Run: `npm test -- src/simulator && npm run build`

Expected: interaction tests and Pages build pass.

```bash
git add src/simulator src/app/routes.tsx
git commit -m "feat: add character and team buff simulator"
```

---

### Task 8: Sourced community team library

**Files:**
- Create: `data/community/teams.json`
- Create: `src/community/teamRepository.ts`
- Create: `src/community/CommunityTeamsPage.tsx`
- Create: `src/community/community.test.tsx`
- Create: `scripts/validate-community-teams.ts`
- Create: `scripts/validate-community-teams.test.ts`
- Modify: `scripts/validate-repository.ts`
- Modify: `src/app/routes.tsx`

**Interfaces:**
- Consumes: `TeamPresetSchema` from Task 2.
- Produces: `loadCommunityTeams(releaseId): Promise<TeamPreset[]>`; `validateCommunitySources(presets): ValidationIssue[]`.

- [ ] **Step 1: Write failing validation tests**

```ts
it("rejects a preset without author, source URL, publication date, or release", () => {
  expect(validateCommunitySources([incompletePreset])).toEqual(
    expect.arrayContaining([expect.objectContaining({ code: "missing_provenance" })]),
  );
});
```

- [ ] **Step 2: Run tests and confirm failure**

Run: `npm test -- scripts/validate-community-teams.test.ts src/community/community.test.tsx`

Expected: FAIL because repository and validator are missing.

- [ ] **Step 3: Add a small, manually verified seed library**

Each record includes exact source URL, author/publisher, published/retrieved dates, applicable release, character slots, substitutions, assumptions, archetype tags, and a project-authored summary. Do not copy guide paragraphs.

- [ ] **Step 4: Build filterable version-aware UI**

Filter by release, archetype, included character, and investment assumptions. Display stale or unavailable sources without deleting historical attribution.

- [ ] **Step 5: Verify and commit**

Run: `npm test -- scripts/validate-community-teams.test.ts src/community && npm run validate:data`

Expected: all seed presets validate and render source links.

```bash
git add data/community src/community scripts/validate-community-teams.ts scripts/validate-community-teams.test.ts scripts/validate-repository.ts src/app/routes.tsx
git commit -m "feat: add sourced community team library"
```

---

### Task 9: Explainable deterministic recommendation agent

**Files:**
- Create: `src/recommendations/request.ts`
- Create: `src/recommendations/enumerateTeams.ts`
- Create: `src/recommendations/scoreTeam.ts`
- Create: `src/recommendations/recommendTeams.ts`
- Create: `src/recommendations/explainRecommendation.ts`
- Create: `src/recommendations/RecommendationPage.tsx`
- Create: `src/recommendations/recommendations.test.ts`
- Create: `src/recommendations/RecommendationPage.test.tsx`
- Modify: `src/app/routes.tsx`

**Interfaces:**
- Consumes: `evaluateTeam()` and community presets.
- Produces: `recommendTeams(request: RecommendationRequest, context: RecommendationContext): RecommendationResult[]`.

- [ ] **Step 1: Write failing deterministic scoring tests**

```ts
it("returns the same ranked teams and score components for identical input", () => {
  const first = recommendTeams(request, context);
  const second = recommendTeams(request, context);
  expect(second).toEqual(first);
  expect(first[0].components).toEqual(expect.objectContaining({ roleCoverage: expect.any(Number) }));
});

it("never recommends an unowned character for a UID-constrained request", () => {
  expect(recommendTeams(uidRequest, context).flatMap((r) => r.team))
    .not.toContain("character:not-owned");
});
```

- [ ] **Step 2: Run recommendation tests and confirm failure**

Run: `npm test -- src/recommendations/recommendations.test.ts`

Expected: FAIL because recommendation functions are missing.

- [ ] **Step 3: Implement legal enumeration and early pruning**

Generate combinations in stable logical-ID order. Apply required/excluded characters, owned roster, legal forms, role coverage, sustain requirements, and user investment bounds before expensive effect evaluation.

- [ ] **Step 4: Implement versioned score components**

```ts
export interface ScoreComponents {
  roleCoverage: number;
  buffApplicability: number;
  mechanicSynergy: number;
  skillPointEconomy: number;
  actionCompatibility: number;
  weaknessCoverage: number;
  survivability: number;
  activationCost: number;
  wastedEffects: number;
  communityPrior: number;
}
```

Store weights with a `weightsVersion`. Clamp the community prior so it cannot compensate for invalid or impossible activation conditions. Break ties by the sorted team logical IDs.

- [ ] **Step 5: Generate evidence-backed explanations and substitutions**

Explanations cite score components and simulator evidence IDs. Substitutions replace one slot at a time and state which score components rise or fall. Return a constraint conflict when fewer than four legal owned characters exist.

- [ ] **Step 6: Build the Agent recommendation page**

Use structured controls for UID, encounter, required/excluded characters, archetype, and comfort/investment preference. Return at least three distinct teams when possible, each with buffs, weaknesses, unmet conditions, and substitutions. Add a typed `NaturalLanguageAdapter` interface but no network model implementation.

- [ ] **Step 7: Verify and commit**

Run: `npm test -- src/recommendations`

Expected: deterministic fixtures, constraint failures, scoring, and UI explanations pass.

```bash
git add src/recommendations src/app/routes.tsx
git commit -m "feat: recommend explainable account-aware teams"
```

---

### Task 10: Isolated multi-UID local profiles and JSON backup

**Files:**
- Create: `src/profiles/profileDatabase.ts`
- Create: `src/profiles/profileService.ts`
- Create: `src/profiles/profileJson.ts`
- Create: `src/profiles/ProfilePage.tsx`
- Create: `src/profiles/ProfileInventoryEditor.tsx`
- Create: `src/profiles/profileService.test.ts`
- Create: `src/profiles/ProfilePage.test.tsx`
- Modify: `src/app/routes.tsx`
- Modify: `src/recommendations/RecommendationPage.tsx`

**Interfaces:**
- Consumes: `AccountProfileSchema`; character/equipment IDs from the selected release.
- Produces: `listProfiles()`, `getProfile(uid)`, `putProfile(profile)`, `deleteProfile(uid)`, `exportProfile(uid)`, and `importProfile(json, strategy)`.

- [ ] **Step 1: Write failing isolation and atomic-import tests**

```ts
it("keeps two UID inventories isolated", async () => {
  await service.putProfile(profile("100000001", ["character:a"]));
  await service.putProfile(profile("100000002", ["character:b"]));
  expect((await service.getProfile("100000001"))?.characters).toHaveLength(1);
  expect((await service.getProfile("100000001"))?.characters[0].logicalId).toBe("character:a");
});

it("does not mutate storage when imported JSON is invalid", async () => {
  const before = await service.listProfiles();
  await expect(service.importProfile("{bad json", "replace")).rejects.toThrow();
  expect(await service.listProfiles()).toEqual(before);
});
```

- [ ] **Step 2: Run profile tests and confirm failure**

Run: `npm test -- src/profiles/profileService.test.ts`

Expected: FAIL because profile storage is missing.

- [ ] **Step 3: Implement IndexedDB schema and UID-keyed transactions**

```ts
interface StarRailWikiDb extends DBSchema {
  profiles: { key: string; value: AccountProfile; indexes: { "by-updatedAt": string } };
}
```

Validate with Zod before every write. Normalize UID as a digit string without converting it to a JavaScript number. Use one transaction per import so failures roll back.

- [ ] **Step 4: Implement deterministic import/export with merge or replace**

Sort owned items by stable ID. Export only the approved profile schema. For same-UID imports, require explicit `merge` or `replace`; merge chooses the greater eidolon/superimposition and preserves distinct relic IDs.

- [ ] **Step 5: Build profile selection and inventory editing UI**

Allow creation, label editing, selection, deletion confirmation, inventory editing, JSON export, and file import. Recommendation and simulator pages can select a UID and constrain available resources.

- [ ] **Step 6: Verify reload isolation and commit**

Run: `npm test -- src/profiles src/recommendations/RecommendationPage.test.tsx`

Expected: two profiles survive database reopen and remain isolated.

```bash
git add src/profiles src/recommendations/RecommendationPage.tsx src/app/routes.tsx
git commit -m "feat: add isolated multi-uid profiles"
```

---

### Task 11: Explicitly public GitHub profile workflow

**Files:**
- Create: `src/profiles/publication.ts`
- Create: `src/profiles/PublicProfileConsent.tsx`
- Create: `src/profiles/PublicProfilePage.tsx`
- Create: `src/profiles/publication.test.tsx`
- Create: `scripts/validate-public-profiles.ts`
- Create: `scripts/validate-public-profiles.test.ts`
- Create: `docs/profile-publication.md`
- Create: `public/profiles/.gitkeep`
- Modify: `scripts/validate-repository.ts`
- Modify: `src/app/routes.tsx`

**Interfaces:**
- Produces: `createPublicProfileExport(profile, consentedAt): PublicAccountProfile`; `loadPublicProfile(uid): Promise<PublicAccountProfile>`; CLI `npm run validate:profiles`.

- [ ] **Step 1: Write failing consent and repository-path validation tests**

```ts
it("refuses publication without an active disclosure confirmation", () => {
  expect(() => createPublicProfileExport(localProfile, null)).toThrow(/public consent required/i);
});

it("rejects mismatched path and body UIDs", () => {
  expect(validatePublicProfileFile("public/profiles/100.json", { ...publicProfile, uid: "200" }))
    .toEqual(expect.arrayContaining([expect.objectContaining({ code: "uid_path_mismatch" })]));
});
```

- [ ] **Step 2: Run publication tests and confirm failure**

Run: `npm test -- src/profiles/publication.test.tsx scripts/validate-public-profiles.test.ts`

Expected: FAIL because publication modules are missing.

- [ ] **Step 3: Implement a separate public export**

Require the exact consent statement in the UI: the UID and inventory become readable by anyone; removal from the current site does not erase Git history. Set `publication.visibility` to `public` and `publication.consentedAt` to the confirmation time. Never auto-upload.

- [ ] **Step 4: Implement strict repository validation**

Reject mismatched paths, missing consent, unexpected fields, unknown game IDs, unreleased release IDs, embedded tokens/keys/cookies, non-JSON files, and files over 1 MiB. Validate all changed profile files in CI.

- [ ] **Step 5: Document and link the GitHub PR workflow**

`docs/profile-publication.md` explains export, disclosure, GitHub upload/PR review, correction, deletion, and history retention. The UI links to the repository's new-file page and tells the user to upload as `public/profiles/<uid>.json`; it does not put profile JSON in a query string.

- [ ] **Step 6: Verify and commit**

Run: `npm test -- src/profiles scripts/validate-public-profiles.test.ts && npm run validate:profiles`

Expected: valid consenting fixture passes; every privacy/security fixture fails with the expected code.

```bash
git add src/profiles scripts/validate-public-profiles.ts scripts/validate-public-profiles.test.ts scripts/validate-repository.ts docs/profile-publication.md public/profiles src/app/routes.tsx package.json
git commit -m "feat: add reviewed public profile workflow"
```

---

### Task 12: Full released-data audit, end-to-end flows, and Pages deployment

**Files:**
- Create: `tests/e2e/wiki.spec.ts`
- Create: `tests/e2e/simulator.spec.ts`
- Create: `tests/e2e/recommendations.spec.ts`
- Create: `tests/e2e/profiles.spec.ts`
- Create: `.github/workflows/deploy-pages.yml`
- Create: `.github/workflows/sync-game-data.yml`
- Create: `README.md`
- Create: `NOTICE`
- Create: `LICENSE`
- Modify: `data/manual/effects.json`
- Modify: `data/community/teams.json`
- Modify: `public/data/releases/index.json`
- Modify: `public/data/releases/4.3/*`

**Interfaces:**
- Consumes: all prior task interfaces.
- Produces: deployable `dist/`; audited current-release coverage report; GitHub Pages deployment; scheduled review PR for future released data.

- [x] **Step 1: Write failing end-to-end acceptance tests**

```ts
test("builds a team, traces a buff, and restores the shared release-pinned URL", async ({ page }) => {
  await page.goto("/#/simulator");
  await selectGoldenTeam(page);
  await expect(page.getByText("全队增伤 +50%")).toBeVisible();
  await page.getByRole("button", { name: "查看全队增伤来源" }).click();
  await expect(page.getByText(/正式服/)).toBeVisible();
  await page.reload();
  await expect(page.getByText("全队增伤 +50%")).toBeVisible();
});
```

Add flows for wiki search, version diff, three deterministic recommendations, two isolated UIDs across reload, invalid profile import rollback, and public-consent export.

- [x] **Step 2: Run end-to-end tests and record expected failures**

Run: `npm run build && npm run test:e2e`

Expected: new tests fail only where current-release data, final navigation, or production deployment integration is incomplete.

- [x] **Step 3: Import and audit the then-current released CN manifest**

Pin the exact released game version and upstream commit in `docs/data-sources.md`. Review every changed character/equipment description, complete manual effect overlays until `unmappedEffects` is zero, and explicitly mark special mechanics unsupported only with a visible reason. Never import a newer preload TextMap into an older approved config release.

- [x] **Step 4: Audit community sources and legal notices**

Verify links, authors, dates, and version applicability for each seed preset. `NOTICE` lists data/code sources and their licenses; `LICENSE` covers original code only. Do not commit third-party images until the audit records their permitted use.

- [x] **Step 5: Add GitHub Pages deployment and reviewed sync PR workflows**

Deployment uses official GitHub Pages actions, `npm ci`, `npm run check`, Playwright smoke tests, and uploads `dist/` only after success. Scheduled sync checks the allowlisted released manifest, generates a deterministic release/diff, and opens a pull request; it has no direct deploy step.

- [x] **Step 6: Run the complete verification suite**

Run:

```bash
npm ci
npm run check
npm run test:e2e
npm audit --audit-level=high
git diff --check
```

Expected: all commands exit 0; coverage has zero unmapped numeric effects; the repository contains no secret; the production build uses `/star_rail_wiki/` assets and hash routes.

R4 verification ledger (2026-08-22): 4.3 has 4,501 candidates, 0 reviewed,
4,501 explicit unsupported and 0 unmapped effects. 4.4 has 4,667 candidates,
42 reviewed, 4,625 explicit unsupported and 0 unmapped effects. The 4.4
reviewed set contains exactly one team target, one single-ally target and one
all-enemies target. Local verification passed 335 Vitest tests, 8 CI-mode
Playwright tests, repository validation, production build, full repository
secret scanning, `npm audit --audit-level=high`, and `git diff --check`.

- [ ] **Step 7: Commit the release candidate**

```bash
git add tests .github/workflows README.md NOTICE LICENSE data public docs/data-sources.md
git commit -m "feat: publish audited star rail wiki"
```

- [ ] **Step 8: Create and push the authorized GitHub repository**

Run after confirming `gh auth status` identifies an account allowed to create repositories under `byshiue`:

```bash
gh repo create byshiue/star_rail_wiki --public --source=. --remote=origin --push
gh api -X POST repos/byshiue/star_rail_wiki/pages -f build_type=workflow
```

Expected: `origin` points to `https://github.com/byshiue/star_rail_wiki.git`, `main` is pushed, Pages is configured for GitHub Actions, and the deployment workflow reports success. Repository creation and profile publication remain explicit external writes; do not repeat either command after an ambiguous failure without checking remote state.

---

## Final verification checklist

- [x] The current released CN game version and every upstream revision are recorded.
- [x] Every released character/equipment description is searchable.
- [x] Numeric buff/debuff coverage reports zero silent omissions.
- [x] Historical revisions and before/after changes remain accessible.
- [x] Simulator results preserve separate operation groups and full evidence chains.
- [x] Recommendation output is deterministic, account-aware, and explains constraints and substitutions.
- [x] Multiple UID profiles remain isolated and JSON import is atomic.
- [x] Public profile export requires explicit consent and passes strict repository validation.
- [x] Community teams contain attribution without copied article text.
- [ ] Unit, component, end-to-end, data, build, audit, and Pages smoke checks pass.
- [x] No GitHub or model-provider credential is shipped to the browser or repository.

The remaining unchecked verification item requires the external GitHub Pages
workflow after Step 8 pushes the repository. All local portions of that item pass.
