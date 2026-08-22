# Star Rail Reviewed Skill Levels Design

## Goal

Make reviewed production effects use the exact level-dependent values from the
locked 4.4 StarRailRes source while keeping every omitted skill level visibly
and deterministically at level 1.

## Audited scaling data

The repository stores a small reviewed scaling snapshot for `ability:110102`
and `ability:110603`. Each record binds the feature logical ID to release
`4.4-cn-2026-08-21`, source revision
`b95e75c7e1273d819d20c530c0b7e13a3ef19fb4`, source path
`index_new/cn/character_skills.json`, its manifest SHA-256, the exact source
description template, `max_level`, parameter column and all parameter rows.

The extraction command must verify the complete locked source file checksum,
record ID, description, maximum level, row count and numeric column before it
writes effect scaling. Repository validation independently derives the same
level values from the checked snapshot and rejects drift in either overlays or
published releases. Bronya uses parameter column 1 and Pela uses column 2.

## Build contract

`TeamMemberBuild.skillLevels` is an optional map from stable feature logical ID
to integer level. Omission of the map or a feature key means level 1. A key is
valid only when the selected member owns one active feature with that logical
ID and the feature owns at least one reviewed effect with scaling values.
Allowed levels are the common `1..N` range derived from those reviewed effects.
Unknown, stale, cross-character, non-scaling and out-of-range keys fail closed.

Canonical share encoding sorts level keys and preserves explicitly selected
levels. Changing a character removes the previous character's levels. Community,
profile and Agent builds omit levels until a user explicitly chooses one; this
is not interpreted as maximum investment.

## Evaluation and evidence

Each selected feature source receives the owning member's explicit level or 1.
All reviewed effects sourced by that feature use the same level. Evidence
contains selected level, maximum level and whether it came from an explicit
selection or the level-1 default. The evidence drawer displays this information
for active, conditional, inactive and unsupported entries without changing the
original immutable source text.

## Simulator UI

For every selected character feature that owns a reviewed scaling effect, the
member editor renders an accessible level selector named after the skill. Its
options cover the audited range and its visible value states the current level.
No selector is rendered for generated, unsupported or non-scaling effects.

## Acceptance criteria

- Level 1 yields Bronya 33% and Pela 30%; level 15 yields 82.5% and 45%.
- Exact 15-row parameters and locked source identity are audit validated.
- Invalid, stale and cross-character IDs and invalid levels are rejected.
- Share encode/decode and reload preserve explicit levels.
- Missing levels are disclosed as `等级 1（默认）` in evidence.
- Production four-person E2E selects level 15 for both skills and verifies
  values, targets, evidence and reload persistence.
- Full tests, E2E, data audit, build, secret scan and dependency audit pass.
