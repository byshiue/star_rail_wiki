# Star Rail Wiki R1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use test-driven-development and execute each task inline.

**Goal:** Implement the approved R1 audit design with fail-closed deterministic data.

**Architecture:** Strict normalization feeds a two-layer effect candidate gate.
Independent immutable release bundles form the history chain. License and release
discovery policies are executable repository checks.

**Tech Stack:** TypeScript, Zod, Vitest, Playwright, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-21-star-rail-wiki-r1-design.md`

## Global constraints

- Never accept mutable source refs, preload, beta, generated effects or unmapped candidates.
- Use Dimbreath `d5c40c0095bc5fdef9ce968c078304a95caab235` and StarRailRes `7b349e39ee0f6f3bf814567995829b99c95e7a93` for 4.3.
- Keep all release manifests, checksums, provenance and audits independent.

### Task 1: Strict parameter normalization

**Files:** `scripts/game-data/normalizeStarRailRes.ts`,
`scripts/game-data/production-format.test.ts`, validation tests.

- [x] Add RED tests for `#N[f1]`, exact one-based columns, missing params and residual tokens.
- [x] Implement format-aware replacement and fail-closed scans.
- [x] Rebuild 4.4 and assert zero unresolved tokens.

### Task 2: Residual numeric-effect completeness

**Files:** `scripts/game-data/extractEffects.ts`, coverage/build scripts,
`scripts/game-data/effects.test.ts`, reviewed overlay data.

- [x] Add RED tests for Dan Heng slow and representative delay/duration/heal/resistance clauses.
- [x] Add stable non-overlapping residual candidates.
- [x] Generate explicit unsupported overlays with mechanism-specific reasons.
- [x] Rebuild and lock the new reviewed/unsupported/unmapped totals.

### Task 3: Real immutable 4.3 history

**Files:** `data/releases/4.3-*/`, `public/data/releases/4.3-*/`, release index,
audit validator, release diff UI and E2E.

- [x] Add RED chain/provenance tests using only checked-in Pages data.
- [x] Pin seven 4.3 checksums and independent audit evidence.
- [x] Build 4.3, link 4.4 previousReleaseId, and expose real before/after revisions.
- [x] Remove route-injected historical E2E data and verify a genuine entity diff.

### Task 4: Third-party license boundary

**Files:** `THIRD_PARTY_LICENSES/AGPL-3.0.txt`, `NOTICE`, source docs,
repository policy test.

- [x] Add RED checks for full AGPL text, scope and immutable source offer.
- [x] Add the license and precise non-legal-advice notice.

### Task 5: Fail-closed scheduled discovery

**Files:** discovery script/tests, `.github/workflows/sync-game-data.yml`, docs.

- [x] Add RED dry-run tests for no-change, released update and preload/beta rejection.
- [x] Implement deterministic discovery/rebuild metadata.
- [x] Restrict workflow permissions and use `gh pr create --draft` only after audit.

### Task 6: Verification and handoff

- [x] Run `npm run check`, `npm run test:e2e`, production audit and `npm audit --audit-level=high` sequentially.
- [ ] Review diffs, commit on main, and report exact coverage totals and residual risk.

R4 locked totals: 4.3 is 4,501 candidates / 0 reviewed / 4,501
unsupported / 0 unmapped; 4.4 is 4,667 candidates / 42 reviewed / 4,625
unsupported / 0 unmapped. Only one reviewed 4.4 effect has team scope; the
reviewed production sample additionally includes one single-ally and one
all-enemies effect. External push and Pages execution remain outside this ledger.
