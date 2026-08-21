import path from "node:path";
import { expect, it } from "vitest";
import { fetchSource } from "./fetchSource";
import { loadSourceManifest } from "./sourceManifest";

const fixtureRoot = path.resolve("scripts/game-data/__fixtures__/source");

it("rejects a mutable latest query ref even when an immutable revision is also present", async () => {
  const manifest = await loadSourceManifest(path.join(fixtureRoot, "manifest.json"));
  manifest.sources[0].downloadUrlTemplate = "{baseUrl}/{path}?ref=latest&reviewed={revision}";

  await expect(fetchSource(manifest, fixtureRoot)).rejects.toThrow(/mutable.*latest|latest.*mutable/i);
});
