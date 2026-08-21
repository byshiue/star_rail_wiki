import {
  GameReleaseBundleSchema,
  ReleaseIndexSchema,
  collectRevisionIdentities,
  type GameReleaseBundle,
  type ReleaseIndex,
} from "../domain/releases";

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch release data (${response.status})`);
  return response.json() as Promise<unknown>;
}

export async function loadReleaseIndex(): Promise<ReleaseIndex> {
  return ReleaseIndexSchema.parse(await fetchJson(`${import.meta.env.BASE_URL}data/releases/index.json`));
}

function assertReleaseReferences(
  requestedId: string,
  bundle: GameReleaseBundle,
  index: ReleaseIndex,
): void {
  if (bundle.release.id !== requestedId) {
    throw new Error(
      `Response release id ${bundle.release.id} does not match requested release ${requestedId}`,
    );
  }

  const knownReleaseIds = new Set(index.releases.map((release) => release.id));
  const references = [
    { path: "release.id", id: bundle.release.id },
    { path: "release.previousReleaseId", id: bundle.release.previousReleaseId },
    ...collectRevisionIdentities(bundle.entities).flatMap((revision) => [
      { path: `${revision.revisionId}.validFromReleaseId`, id: revision.validFromReleaseId },
      { path: `${revision.revisionId}.validToReleaseId`, id: revision.validToReleaseId },
    ]),
  ];

  for (const reference of references) {
    if (reference.id !== null && !knownReleaseIds.has(reference.id)) {
      throw new Error(`unknown releaseId ${reference.id} at ${reference.path}`);
    }
  }
}

export async function loadRelease(id: string): Promise<GameReleaseBundle> {
  const base = `${import.meta.env.BASE_URL}data/releases/${encodeURIComponent(id)}`;
  const [release, entities, releaseIndex] = await Promise.all([
    fetchJson(`${base}/release.json`),
    fetchJson(`${base}/entities.json`),
    fetchJson(`${import.meta.env.BASE_URL}data/releases/index.json`),
  ]);
  const bundle = GameReleaseBundleSchema.parse({ release, entities });
  const index = ReleaseIndexSchema.parse(releaseIndex);
  assertReleaseReferences(id, bundle, index);
  return bundle;
}
