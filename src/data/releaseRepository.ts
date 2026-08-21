import { GameReleaseBundleSchema, ReleaseIndexSchema, type GameReleaseBundle, type ReleaseIndex } from "../domain/releases";

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch release data (${response.status})`);
  return response.json() as Promise<unknown>;
}

export async function loadReleaseIndex(): Promise<ReleaseIndex> {
  return ReleaseIndexSchema.parse(await fetchJson(`${import.meta.env.BASE_URL}data/releases/index.json`));
}

export async function loadRelease(id: string): Promise<GameReleaseBundle> {
  const base = `${import.meta.env.BASE_URL}data/releases/${encodeURIComponent(id)}`;
  const [release, entities] = await Promise.all([
    fetchJson(`${base}/release.json`),
    fetchJson(`${base}/entities.json`),
  ]);
  return GameReleaseBundleSchema.parse({ release, entities });
}
