# Star Rail Wiki R1 Audit Design

## Goal

Close five audit findings without weakening any production gate: resolve every
StarRailRes parameter token, account for every numeric effect clause, publish a
real immutable 4.3→4.4 history, state AGPL-derived boundaries, and make scheduled
release discovery open draft review PRs only.

## Data and effect architecture

The normalizer is fail-closed. It accepts one-based `#N[i]` and `#N[fK]`
tokens, formats each level from the exact parameter column, and rejects missing
columns, missing parameter arrays, unknown formats, or any token that remains
after normalization. Repository validation independently scans production
entities and effects and requires zero unresolved tokens.

Effect extraction has two layers. Existing phrase rules produce typed candidates.
A residual detector then splits every source description into stable source-order
clauses and creates an explicit candidate for any numeric, percent, or parameter
effect clause not covered by a phrase rule. Every candidate must be consumed by a
reviewed or unsupported overlay. Unsupported reasons identify the unmodelled
mechanic; generated or unmapped candidates remain forbidden.

## Immutable release history

Released 4.3 uses Dimbreath
`d5c40c0095bc5fdef9ce968c078304a95caab235` and StarRailRes
`7b349e39ee0f6f3bf814567995829b99c95e7a93`. The latter is the direct parent
of the StarRailRes 4.4 update commit and contains all seven required CN indexes.
Released 4.4 retains its existing immutable source and points to 4.3. Each release
has independent manifests, checksums, provenance and audit evidence. The browser
loads both real bundles for diffs; tests may not inject synthetic history.

## Licensing and automation

`THIRD_PARTY_LICENSES/AGPL-3.0.txt` carries the complete license text. NOTICE
separates MIT original work from StarRailRes-derived data and source/transform
scripts, identifies any derived assets, provides immutable source-offer URLs, and
states that the notice is not legal advice.

Scheduled discovery accepts only official released-version evidence and immutable
upstream revisions. No change exits successfully. A new released version creates
an automation branch, rebuilds and audits, then opens a draft PR with `gh`.
It never updates main, deploys, consumes preload/beta data, or exposes secrets to
fork code.

## Acceptance

- Production audit reports zero unresolved parameter tokens and zero unmapped candidates.
- Dan Heng slow and all other residual numeric clauses have stable explicit candidates.
- Real 4.3 and 4.4 are independently reproducible and their diff works from checked-in data.
- License and workflow tests enforce the stated boundaries.
- Low-concurrency unit, data audit, build, E2E and dependency audit pass.
