# Game data sources

The importer accepts only a review-supplied manifest. Each manifest records the released game version and, independently for every source, its name, base URL, immutable revision, upstream paths, retrieval time, and reviewed SHA-256 checksums. It never resolves `master`, `latest`, or another mutable ref.

## Reviewed local fixture

Task 3 proves deterministic import with the checked-in fixture at `scripts/game-data/__fixtures__/source`. This is a small reviewed test representation; it is **not** a production Honkai: Star Rail 4.3 snapshot and must not be described or published as one. The existing `public/data/releases/4.3-fixture` remains synthetic.

The fixture manifest deliberately keeps source identities separate:

- `d5c40c00` identifies the Dimbreath 4.3 evidence fixture snapshot. It is not a StarRailRes commit.
- `93fa10b7` identifies the checked-in StarRailRes-shaped index fixture only. It is not claimed to be an audited production revision.

Task 12 must audit matching immutable upstream revisions, licensing, and every changed description before a full real snapshot can be published.

Exact deterministic invocation:

```bash
npm run data:import -- \
  --version 4.3 \
  --source-revision d5c40c00 \
  --manifest scripts/game-data/__fixtures__/source/manifest.json \
  --source-root scripts/game-data/__fixtures__/source \
  --output /tmp/star-rail-release-a
```

Repeat with `/tmp/star-rail-release-b`, then run `diff -ru /tmp/star-rail-release-a /tmp/star-rail-release-b`. Omitting `--source-root` downloads each manifest path from its immutable revision URL into a temporary directory and verifies its checksum before parsing. Provider-specific raw URL layouts can be represented with the manifest's `downloadUrlTemplate`; `{baseUrl}`, `{revision}`, and `{path}` are replaced without consulting a mutable branch.

The intentionally invalid fixture at `scripts/game-data/__fixtures__/preload-source` combines a released 4.3 manifest with preload 4.4 source metadata. The release guard rejects it before reading incomplete indexes.
