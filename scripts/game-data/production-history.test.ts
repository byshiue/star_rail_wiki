import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { ReleaseIndexSchema } from "../../src/domain/releases";
import { ApprovedSourceManifestSchema } from "./sourceManifest";

it("publishes an immutable released 4.3 predecessor for current 4.4", async () => {
  const index = ReleaseIndexSchema.parse(JSON.parse(await readFile("public/data/releases/index.json", "utf8")));
  const historical = index.releases.find(({ id }) => id === "4.3-cn-2026-06-10");
  const current = index.releases.find(({ id }) => id === index.currentReleaseId);
  expect(historical).toMatchObject({
    gameVersion: "4.3",
    channel: "released",
    sources: [{ revision: "7b349e39ee0f6f3bf814567995829b99c95e7a93" }],
  });
  expect(current?.previousReleaseId).toBe("4.3-cn-2026-06-10");

  const manifest = ApprovedSourceManifestSchema.parse(JSON.parse(
    await readFile("data/releases/4.3-cn-2026-06-10/source-manifest.json", "utf8"),
  ));
  expect(manifest.sources[0]?.revision).toBe("7b349e39ee0f6f3bf814567995829b99c95e7a93");
  expect(Object.values(manifest.sources[0]?.fileChecksums ?? {}))
    .toHaveLength(7);
});
