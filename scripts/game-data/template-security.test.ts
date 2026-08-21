import path from "node:path";
import { expect, it } from "vitest";
import { fetchSource } from "./fetchSource";
import { loadSourceManifest } from "./sourceManifest";

const fixtureRoot = path.resolve("scripts/game-data/__fixtures__/source");

it("rejects mutable master or latest path segments even when the template mentions the revision", async () => {
  const manifest = await loadSourceManifest(path.join(fixtureRoot, "manifest.json"));
  manifest.sources[0].downloadUrlTemplate = "{baseUrl}/master/{path}?reviewed={revision}";

  await expect(fetchSource(manifest, fixtureRoot)).rejects.toThrow(/mutable.*master|master.*mutable/i);
});
