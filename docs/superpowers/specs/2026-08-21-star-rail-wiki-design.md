# Star Rail Wiki Design

## 1. Purpose

`star_rail_wiki` is a Simplified Chinese, unofficial Honkai: Star Rail reference and team-building application. It combines complete released-game descriptions with versioned, machine-readable combat effects so a player can inspect every available buff, simulate a four-character team, review sourced community teams, and receive explainable team recommendations.

The first public release targets the currently released Mainland China server data only. Test-server, leaked, and unreleased content is excluded.

## 2. Product goals

The application must:

1. List every released character, skill, trace, eidolon, light cone, relic set, and planar ornament effect in Simplified Chinese.
2. Show which buffs and enemy debuffs a selected character build can create, including target, trigger, duration, stacking, and source.
3. Simulate the combined effects of a legal four-character team without pretending to be a full damage simulator.
4. Store sourced community team recommendations with author, URL, publication date, applicable game version, and a concise original summary.
5. Recommend teams with a deterministic and explainable rules engine; an optional language-model adapter may interpret natural-language requests and explain results, but may not invent or alter game numbers.
6. Maintain multiple independent account profiles named by UID, each recording owned characters, eidolons, light cones, superimpositions, and equipment.
7. Keep profiles private in the browser by default, support JSON import/export, and allow a user to publish a profile only after an explicit public-disclosure confirmation and repository review.
8. Preserve the source game version and upstream provenance of every character and equipment revision, including before/after changes when an effect is strengthened or otherwise changed.

## 3. Non-goals for the first release

- Frame-perfect or turn-by-turn combat simulation.
- A universal DPS optimizer.
- User authentication, private cloud storage, or automatic cross-device synchronization.
- Direct browser storage of GitHub or model-provider credentials.
- Automatic publication of data-source updates without review.
- Reproduction of full third-party guide articles.

## 4. Architecture

The product is a React and TypeScript single-page application built with Vite and deployed as static assets to GitHub Pages. All search, profile storage, effect evaluation, team enumeration, and deterministic recommendation logic runs in the browser.

GitHub Actions performs four repository workflows:

1. validate code and data on pull requests;
2. build and publish the verified `main` revision to GitHub Pages;
3. periodically fetch released-game upstream data and open or update a reviewable data-change pull request;
4. validate public UID profile pull requests before they can be merged.

The static site never accepts arbitrary uploads. A public profile is committed under `public/profiles/<uid>.json` through the GitHub web interface or a pull request. GitHub Pages republishes it only after schema validation and repository approval.

## 5. Data sources and provenance

Machine-readable released-game data may be derived from maintained repositories such as Dimbreath's TurnBasedGameData. HoYoWiki is used as a human-verification reference where available. Character, light-cone, and relic indexes or assets may be cross-checked against March7th resources only after a license audit.

Initial references:

- Dimbreath TurnBasedGameData: <https://gitlab.com/Dimbreath/turnbasedgamedata/>
- March7th resource documentation: <https://march7th.xyz/en/resource/>
- HoYoWiki: <https://wiki.hoyolab.com/m/hsr/home?lang=zh-cn>
- HSR-Data parser reference: <https://github.com/kel-z/HSR-Data>

Each import creates an immutable `DataRelease` containing:

```ts
interface DataRelease {
  id: string;
  gameVersion: string;
  region: "cn";
  channel: "released";
  importedAt: string;
  reviewedAt: string | null;
  sources: SourceSnapshot[];
  previousReleaseId: string | null;
}

interface SourceSnapshot {
  name: string;
  url: string;
  revision: string;
  fileChecksums: Record<string, string>;
  retrievedAt: string;
}
```

Every game entity has a stable logical ID and one or more immutable revisions. A revision records `validFromReleaseId`, optional `validToReleaseId`, source references, original text, parsed fields, and review status. A new version never overwrites an older revision. The UI and all shareable simulator URLs pin a `DataRelease.id`.

The current upstream game version is discovered and validated during import rather than hard-coded. The site displays the last reviewed release and its upstream revision.

## 6. Domain model

The core entities are:

- `CharacterRevision`: identity, rarity, element, path, base metadata, abilities, traces, eidolons, and source provenance.
- `AbilityRevision`: basic attack, skill, ultimate, talent, technique, follow-up, summon/memosprite, enhanced actions, and other released mechanics.
- `EquipmentRevision`: light cone or relic/planar set, path restriction where applicable, superimposition values, set thresholds, and effect text.
- `Effect`: a normalized, evaluable combat effect produced by an ability, trace, eidolon, or equipment revision.
- `TeamPreset`: a sourced community team with slots, substitutions, requirements, applicable release, and attribution.
- `AccountProfile`: a local or explicitly public inventory belonging to one UID.

An `Effect` contains at minimum:

```ts
interface Effect {
  id: string;
  sourceRevisionId: string;
  metric: EffectMetric;
  operation: "flat" | "percent" | "multiplier" | "override";
  value: ScalingValue;
  target: TargetSelector;
  trigger: TriggerExpression;
  duration: DurationExpression;
  stacking: StackingRule;
  conditions: ConditionExpression[];
  dispellable: boolean | null;
  reviewStatus: "generated" | "reviewed" | "unsupported";
}
```

Supported metrics include attack, HP, defense, speed, critical rate, critical damage, break effect, effect hit rate, effect resistance, energy, damage bonus, vulnerability, defense reduction/ignore, resistance reduction/penetration, action advance/delay, healing, shielding, skill-point changes, and mechanic-specific counters.

Special mechanics that cannot yet be evaluated remain visible with their complete text and an explicit `unsupported` label. The build must fail its release completeness gate if a numeric buff or debuff is silently omitted.

## 7. Version-aware data pipeline

The importer:

1. fetches only allowlisted released-game sources;
2. stores upstream revision identifiers and checksums;
3. normalizes text and stable IDs without discarding the original descriptions;
4. generates candidate effects;
5. overlays reviewed manual corrections for ambiguous conditions or formulas;
6. compares every entity and effect with the previous release;
7. emits a human-readable change report;
8. validates schema, reference integrity, coverage, and released-channel policy;
9. opens a pull request rather than publishing directly.

If fetching, parsing, or validation fails, the existing reviewed release remains active. The website displays its review date and never serves a partially generated release.

## 8. Buff and team simulator

The user selects a pinned data release, four characters, eidolons, trace levels, light cones and superimpositions, equipment sets, and scenario conditions. Conditions include enemy weakness, enemy state, battle entry, action type, skill-point events, follow-up or summon events, break state, stack count, and whether conditional effects have been activated.

The evaluator resolves effects in this order:

1. determine whether the source is equipped and legal;
2. evaluate source, team, target, and enemy conditions;
3. resolve targets;
4. resolve value scaling, duration, and stacks;
5. group effects by game metric and operation instead of naively summing unlike multipliers;
6. produce active, conditional, inactive, unsupported, and potentially wasted results;
7. attach an evidence chain back to the exact ability, eidolon, or equipment revision and data source.

The UI separates persistent team buffs, conditional buffs, self-only buffs, enemy debuffs, action manipulation, and resource effects. Selecting a result reveals its complete evidence chain and the pinned game version.

## 9. Explainable recommendation agent

The deterministic recommendation engine accepts:

- account UID or unrestricted roster;
- required or excluded characters;
- enemy weaknesses and encounter mode;
- desired archetype or damage dealer;
- allowed eidolons, light cones, and equipment;
- player preferences such as comfort, low investment, or maximum synergy.

It enumerates legal four-character teams, prunes structurally invalid candidates, evaluates their effects using the same simulator, and scores candidates using versioned weights for:

- role and sustain coverage;
- buff applicability and uptime potential;
- damage-type, path, summon, break, follow-up, damage-over-time, and other mechanic synergy;
- skill-point economy;
- speed and action-order compatibility;
- weakness coverage;
- survivability;
- activation difficulty and wasted effects;
- compatibility with the selected account investment;
- sourced community-team evidence as a bounded ranking prior.

The engine returns at least three distinct candidates when the roster permits. Each result includes score components, active buff chains, unmet conditions, weaknesses, and substitutions. Community popularity cannot override impossible conditions or calculated incompatibility.

An optional model adapter may convert natural language to a validated `RecommendationRequest` and verbalize the returned evidence. It has no authority to edit effect values, source data, or deterministic scores. The core feature works without an API key.

## 10. Community team library

Every `TeamPreset` records:

- original source URL and author/publisher;
- publication date and date retrieved;
- applicable game release;
- four team slots plus substitutions;
- eidolon or equipment assumptions;
- encounter or archetype tags;
- a short project-authored summary;
- source availability status.

The repository does not copy full articles. Broken links remain recorded as historical provenance and are flagged for maintenance.

## 11. Multi-UID account profiles

Account profiles are stored in IndexedDB, keyed by UID. One profile cannot read or mutate another profile's inventory without an explicit selection. Local profiles include a schema version, data release, timestamps, owned character investments, owned light cones, and equipped or owned relic records.

```ts
interface AccountProfile {
  schemaVersion: number;
  uid: string;
  label?: string;
  region?: "cn" | "asia" | "america" | "europe" | "tw_hk_mo";
  dataReleaseId: string;
  updatedAt: string;
  characters: OwnedCharacter[];
  lightCones: OwnedLightCone[];
  relics: OwnedRelic[];
  publication?: {
    consentedAt: string;
    visibility: "public";
  };
}
```

Import validates the file before changing local state and requires the user to choose merge or replace for the same UID. Export is deterministic and excludes browser-only metadata.

Publishing is deliberately separate from export. Before publication, the UI states that the UID and inventory will be publicly readable. The user must actively confirm public disclosure; the exported public file records that consent timestamp. Repository validation rejects paths not matching `public/profiles/<uid>.json`, schema errors, mismatched path and body UIDs, unknown game IDs, unreleased data references, secrets, unexpected fields, and files without public-consent metadata.

Deletion or correction of a published profile occurs through a new repository change. The UI documentation must explain that Git history may preserve previous public revisions.

## 12. User interface

The application has six primary areas:

1. **资料库** — searchable characters and equipment with complete descriptions, parsed effects, versions, and sources.
2. **角色构筑** — one character's eidolon, traces, light cone, sets, and resulting buffs.
3. **配队实验室** — four slots, scenario controls, categorized effects, and evidence chains.
4. **Agent 推荐** — UID/roster constraints, encounter conditions, ranked teams, explanations, and substitutions.
5. **社区配队** — versioned, sourced presets and filters.
6. **账号与版本** — isolated UID profiles, import/export/publication workflow, data releases, and before/after diffs.

The approved visual direction places the selected team and pinned version beside the categorized buff results. It uses responsive layouts, keyboard-accessible native controls, clear condition states, and source/version badges. The design must work at 320 px width and on desktop.

## 13. GitHub Pages and repository workflows

The repository will be named `star_rail_wiki` and published under the authorized `byshiue` GitHub account. The production site is built with a repository-aware base path so direct asset loading works under `/star_rail_wiki/`. Client-side routes use a GitHub Pages-compatible fallback or hash routing so refreshing a shared simulator URL does not return 404.

Pull-request checks include:

- TypeScript type checking and linting;
- unit and component tests;
- production build;
- game-data schema and completeness validation;
- effect coverage and reference integrity;
- community-source schema validation;
- public-profile privacy and schema validation;
- a generated data diff when a `DataRelease` changes.

Only a passing `main` revision is deployable.

## 14. Error handling

- Missing or unavailable source: retain the last reviewed release and display freshness information.
- Unknown effect condition: show complete source text and an unsupported marker; never treat it as active.
- Invalid team or equipment: explain the exact legality violation and omit it from evaluation.
- Stale profile IDs after a game update: keep the profile readable, map stable IDs where possible, and surface unresolved items for user review.
- Invalid imported profile: report validation errors without partially mutating IndexedDB.
- Public-profile fetch failure: retain local profiles and explain that the public copy is unavailable.
- Recommendation search with too few owned characters: return the constraint conflict and useful roster substitutions instead of fabricated teams.

## 15. Verification and acceptance criteria

The initial release is acceptable only when:

1. every released character, ability, trace, eidolon, light cone, and relic/planar set effect in the pinned current release is searchable and carries provenance;
2. a coverage report proves that all detected numeric buffs and debuffs are either reviewed effects or explicitly unsupported;
3. representative golden fixtures verify percentage, flat, multiplier, stacking, duration, target, action, and enemy-debuff behavior;
4. team simulation changes correctly with eidolon, superimposition, equipment, trigger, target, and pinned data release;
5. strengthened or changed entities retain old revisions and produce a readable before/after diff;
6. recommendation tests cover roster restrictions, sustain/role coverage, incompatible conditions, substitutions, stable score explanations, and deterministic ordering;
7. multiple local UIDs remain isolated through create, edit, delete, import, export, and reload operations;
8. public profile validation rejects missing consent, mismatched UID paths, secrets, unknown fields, and invalid game IDs;
9. end-to-end tests cover wiki search, character build, four-person simulation, recommendation, version switching, profile import/export, and GitHub Pages route refresh;
10. the production build succeeds with no embedded secret and all referenced sources are listed in the credits/notice page.

## 16. Delivery sequence

Implementation proceeds in independently testable vertical slices:

1. repository foundation, data schemas, a small reviewed fixture, and GitHub Pages deployment;
2. released-game importer, immutable releases, completeness checks, and version diffs;
3. searchable wiki and character/equipment detail views;
4. normalized effect evaluator and four-character simulator;
5. community team schema and sourced library;
6. deterministic recommendation agent;
7. multi-UID local profiles, JSON import/export, and public-profile review workflow;
8. full-current-release data audit, responsive UI verification, documentation, and publication.

Each slice must pass its own tests and keep the site usable. Full data coverage is a release gate, not a claim inferred from a successful parser run.

## 17. Legal and attribution policy

Original project code will use a permissive license selected during repository setup. Generated game data, upstream software, and visual assets remain separately attributed and are not relicensed by implication. Before vendoring any AGPL or otherwise restricted upstream material, the implementation must either comply with that license for the combined work or avoid redistribution and use a permitted alternative.

The site includes an unofficial-project disclaimer, source credits, takedown/contact instructions, and the statement that game names, text, and art belong to their respective rights holders. Third-party guide content is limited to factual team structures, project-authored summaries, and links.
