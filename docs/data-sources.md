# Game data sources

The importer accepts only a review-supplied manifest. Each manifest records the released game version and, independently for every source, its name, base URL, immutable revision, upstream paths, retrieval time, and reviewed SHA-256 checksums. It never resolves `master`, `latest`, or another mutable ref.

## Reviewed local fixture

Task 3 proves deterministic import with the checked-in fixture at `scripts/game-data/__fixtures__/source`. This is a small reviewed test representation; it is **not** a production Honkai: Star Rail 4.3 snapshot and must not be described or published as one. The existing `public/data/releases/4.3-fixture` remains synthetic.

The fixture manifest deliberately keeps source identities separate:

- `d5c40c00` identifies the Dimbreath 4.3 evidence fixture snapshot. It is not a StarRailRes commit.
- `93fa10b7` identifies the checked-in StarRailRes-shaped index fixture only. It is not claimed to be an audited production revision.


## Reviewed character role annotations

Upstream character indexes are kept byte-for-byte free of project-invented role fields. Versioned damage, support, and sustain tags live in `data/manual/character-roles.json`; every annotation records its release, review status, and evidence provenance. Release composition fails unless each active character has exactly one matching annotation, and repository validation verifies the checked-in bundle against this overlay.

Exact deterministic invocation:

```bash
npm run data:import -- \
  --version 4.3 \
  --source-revision d5c40c00 \
  --manifest scripts/game-data/__fixtures__/source/manifest.json \
  --source-root scripts/game-data/__fixtures__/source \
  --roles data/manual/character-roles.json \
  --output /tmp/star-rail-release-a
```

Repeat with `/tmp/star-rail-release-b`, then run `diff -ru /tmp/star-rail-release-a /tmp/star-rail-release-b`. Omitting `--source-root` downloads each manifest path from its immutable revision URL into a temporary directory and verifies its checksum before parsing. Provider-specific raw URL layouts can be represented with the manifest's `downloadUrlTemplate`; `{baseUrl}`, `{revision}`, and `{path}` are replaced without consulting a mutable branch.

The intentionally invalid fixture at `scripts/game-data/__fixtures__/preload-source` combines a released 4.3 manifest with preload 4.4 source metadata. The release guard rejects it before reading incomplete indexes.

## Current Mainland China release audit (as of 2026-08-21)

Production current is `4.4-cn-2026-08-21`. The official HoYoLAB Version 4.4 notice states 4.4 runs from 2026-07-15 until 2026-08-26 06:00 (UTC+8); 4.5 previews, preload, beta and leaks are excluded. Machine-readable evidence is in `data/releases/4.4-cn-2026-08-21/audit.json`.

- Channel authority: https://www.hoyolab.com/article/45851903
- Released-client cross-check: DimbreathBot/TurnBasedGameData `648b08fbdb2e49739ebbf1210c9a189fcfc5e2d7` (`OSPRODWin4.4.0_D15909703_A15802547_L15874300`).
- Chinese indexes: Mar-7th/StarRailRes `b95e75c7e1273d819d20c530c0b7e13a3ef19fb4`; seven SHA-256 values are pinned in the production source manifest.

The bundle contains 95 characters, 762 skills, 1,912 trace nodes, 570 canonical eidolons, 165 light cones and 60 relic/planar sets. Sixty unreferenced seven-digit alternate enhanced eidolon records are excluded with a reason and ID-list checksum in the audit; skill and trace orphan counts are zero.

The immutable predecessor `4.3-cn-2026-06-10` uses StarRailRes commit
`7b349e39ee0f6f3bf814567995829b99c95e7a93` and Dimbreath released-client
evidence `d5c40c0095bc5fdef9ce968c078304a95caab235`; 4.4 points to it directly.

Coverage is deliberately candid: 3,672 numeric-effect candidates map one-to-one to 39 reviewed unconditional effects and 3,633 explicit unsupported effects. Unsupported entries retain the complete Chinese clause and a mechanic-specific reason and never enter arithmetic. Both `unmappedEffects` and unresolved StarRailRes parameter tokens are zero; this does not mean that every mechanic is simulated.

Production updates require a new release ID, official channel evidence, immutable revisions, checksums, entity diff, role review and separate reviewed/unsupported coverage in a Pull Request. Scheduled automation never deploys or overwrites current data directly.

The weekly workflow queries the public HoYoLAB official-notice feed, accepts only a
published `Version X.Y … Update Details` article, and requires matching 40-character
Dimbreath and StarRailRes commits. No change exits cleanly. A candidate is written only
to an automation branch, the checked-in releases are rebuilt/audited with `npm run check`,
and `gh pr create --draft` opens the human review gate; it never pushes `main`.
