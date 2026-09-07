import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadCachedRenderAssets } from "./assets";

const manifestEntry = {
  logicalId: "character:1",
  role: "character-splash" as const,
  url: "https://assets.example/character-1.png",
  allowedHost: "assets.example",
  mediaType: "image/png" as const,
  checksum: null,
  attribution: "Official artwork",
  cacheKey: "character-1",
};

describe("offline wiki cached render assets", () => {
  it("turns a verified local cache file into a self-contained data URL", () => {
    const cacheRoot = mkdtempSync(join(tmpdir(), "offline-wiki-render-assets-"));
    writeFileSync(join(cacheRoot, "character-1.png"), new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

    expect(loadCachedRenderAssets([manifestEntry], cacheRoot)).toEqual([{
      logicalId: "character:1",
      dataUrl: "data:image/png;base64,iVBORw0KGgo=",
      attribution: "Official artwork",
    }]);
  });

  it("fails closed when a cached file no longer matches its declared checksum", () => {
    const cacheRoot = mkdtempSync(join(tmpdir(), "offline-wiki-render-assets-"));
    writeFileSync(join(cacheRoot, "character-1.png"), new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

    expect(() => loadCachedRenderAssets([{
      ...manifestEntry,
      checksum: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    }], cacheRoot)).toThrow(/checksum/i);
  });

  it("rejects a cached file with a forged extension and invalid signature", () => {
    const cacheRoot = mkdtempSync(join(tmpdir(), "offline-wiki-render-assets-"));
    writeFileSync(join(cacheRoot, "character-1.png"), new Uint8Array([1, 2, 3]));

    expect(() => loadCachedRenderAssets([manifestEntry], cacheRoot)).toThrow(/signature/i);
  });
});
