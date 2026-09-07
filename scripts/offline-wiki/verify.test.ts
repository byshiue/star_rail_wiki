import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildOfflineWiki, type BuildManifest } from "./build";
import { verifyOfflineWiki } from "./verify";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "releases");
const loreRoot = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "lore");

async function buildFixture(outputRoot: string): Promise<void> {
  await buildOfflineWiki({
    releasesRoot: fixtureRoot,
    editorialRoot: join(repositoryRoot, "data", "offline-wiki"),
    releaseId: "4.4-fixture",
    outputRoot,
    loreRoot,
    renderPdf: async () => ({
      bytes: new TextEncoder().encode("%PDF-1.7\n/Type /Page\n%%EOF\n"),
      pageCount: 1,
    }),
  });
}

type ManifestMutation = (manifest: BuildManifest) => void;

function mutateManifest(outputRoot: string, mutate: ManifestMutation): void {
  const path = join(outputRoot, "builds", "4.4-fixture", "build-manifest.json");
  const manifest = JSON.parse(readFileSync(path, "utf8")) as BuildManifest;
  mutate(manifest);
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

describe("offline wiki PDF verification", () => {
  it("verifies every declared PDF checksum and detects output corruption", async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "offline-wiki-verify-"));
    await buildFixture(outputRoot);

    expect(verifyOfflineWiki({ outputRoot, releaseId: "4.4-fixture" })).toEqual({
      releaseId: "4.4-fixture",
      verifiedFiles: 12,
      pages: 12,
    });

    writeFileSync(
      join(outputRoot, "builds", "4.4-fixture", "pdf", "04-差分宇宙-方程-001.pdf"),
      "%PDF-1.7\ncorrupted\n%%EOF\n",
    );
    expect(() => verifyOfflineWiki({ outputRoot, releaseId: "4.4-fixture" })).toThrow(/checksum/i);
  });

  it("requires every ordered HTML input to have exactly one matching PDF output", async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "offline-wiki-verify-"));
    await buildFixture(outputRoot);
    mutateManifest(outputRoot, (manifest) => {
      manifest.outputs[5].filename = "04-差分宇宙-奇物-001.pdf";
    });
    expect(() => verifyOfflineWiki({ outputRoot, releaseId: "4.4-fixture" })).toThrow(/HTML\/PDF|match/i);
  });

  it("rejects missing family indexes", async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "offline-wiki-verify-"));
    await buildFixture(outputRoot);
    mutateManifest(outputRoot, (manifest) => {
      const index = manifest.outputs.findIndex((output) => output.filename === "05-世界观-索引.pdf");
      manifest.outputs.splice(index, 1);
      manifest.inputs.splice(index, 1);
      manifest.outputs.forEach((output, order) => { output.order = order; });
    });
    expect(() => verifyOfflineWiki({ outputRoot, releaseId: "4.4-fixture" })).toThrow(/canonical|family|HTML\/PDF/i);
  });

  const invalidManifestCases: Array<[string, ManifestMutation]> = [
    ["duplicate filename", (manifest) => { manifest.outputs[1]!.filename = manifest.outputs[0]!.filename; }],
    ["duplicate order", (manifest) => { manifest.outputs[1]!.order = manifest.outputs[0]!.order; }],
    ["order gap", (manifest) => { manifest.outputs[5]!.order = 99; }],
    ["path separator", (manifest) => { manifest.outputs[5]!.filename = "nested/unsafe.pdf"; }],
    ["metadata mismatch", (manifest) => { manifest.outputs[5]!.group = "curio"; }],
  ];

  it.each(invalidManifestCases)("rejects %s in manifest v2", async (_name, mutate) => {
    const outputRoot = mkdtempSync(join(tmpdir(), "offline-wiki-verify-"));
    await buildFixture(outputRoot);
    mutateManifest(outputRoot, mutate);
    expect(() => verifyOfflineWiki({ outputRoot, releaseId: "4.4-fixture" })).toThrow();
  });
});
