# Star Rail Reviewed Skill Levels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply audited StarRailRes skill-level scaling to reviewed effects and preserve explicit member levels through simulation and share URLs.

**Architecture:** A checksum-bound reviewed scaling snapshot derives effect arrays. Member-owned feature-level selections flow through strict build validation into source evaluation and evidence; omission is level 1.

**Tech Stack:** TypeScript, Zod, React, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-22-star-rail-skill-levels-design.md`

## Global Constraints

- Only immutable 4.4 source revision `b95e75c7e1273d819d20c530c0b7e13a3ef19fb4` is accepted.
- Feature logical IDs, never effect IDs or display names, identify skill levels.
- Missing levels mean level 1 and must be disclosed as default.
- Unknown ownership, stale IDs, non-scaling features and invalid ranges fail closed.
- Do not push.

### Task 1: Audited exact scaling data

**Files:**
- Create: `data/releases/4.4-cn-2026-08-21/reviewed-skill-scaling.json`
- Create: `scripts/game-data/reviewedSkillScaling.ts`
- Test: `scripts/game-data/reviewedSkillScaling.test.ts`
- Modify: `scripts/game-data/applyR4ReviewedEffects.ts`
- Modify: `scripts/validate-production-audit.ts`
- Modify: reviewed 4.4 effects and bundles

- [x] Write RED tests for source identity, exact parameter rows, endpoints and drift.
- [x] Implement checksum-bound extraction and repository validation.
- [x] Rebuild 4.4 and prove Bronya/Pela arrays contain all levels 1..15.

### Task 2: Member feature-level build contract

**Files:**
- Modify: `src/effects/context.ts`
- Modify: `src/effects/evaluateTeam.ts`
- Modify: `src/simulator/teamBuild.ts`
- Test: `src/effects/evaluateTeam*.test.ts`, `src/simulator/simulator*.test.tsx`

- [x] Write RED tests for default level 1, range, ownership, stale ID and URL roundtrip.
- [x] Add canonical `TeamMemberBuild.skillLevels` and strict validation.
- [x] Route selected/default feature levels into evaluation and evidence.

### Task 3: Accessible simulator controls and disclosure

**Files:**
- Modify: `src/simulator/TeamSlots.tsx`
- Modify: `src/simulator/EvidenceDrawer.tsx`
- Modify: profile/community/recommendation build producers and tests as required

- [x] Write RED interaction tests for visible selectors, edits and default evidence.
- [x] Implement reviewed-scaling-only selectors and character-change cleanup.
- [x] Show selected maximum and explicit/default status in evidence.

### Task 4: Production acceptance and handoff

**Files:**
- Modify: `tests/e2e/simulator.spec.ts`
- Modify: `README.md`, `src/wiki/WikiPage.tsx`
- Modify: Task 12/R5 ledgers

- [x] Extend the four-person E2E to select level 15 and verify 82.5%/45%.
- [x] Verify share reload retains both selected levels and evidence.
- [x] Update honest skill-level-aware coverage copy.
- [x] Run full Vitest, CI-mode E2E, data audit, build, scanner, npm audit and diff checks.
- [x] Request independent review, fix blockers, commit on `main`, report DONE without push.
