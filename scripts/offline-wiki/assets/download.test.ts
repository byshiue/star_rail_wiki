import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { downloadAsset } from "./download";

const baseAsset = {
  logicalId: "character:1",
  role: "character-splash" as const,
  url: "https://assets.example/character-1.png",
  allowedHost: "assets.example",
  mediaType: "image/png" as const,
  checksum: null,
  attribution: "Official artwork",
  cacheKey: "character-1",
};

describe("offline wiki asset downloader", () => {
  it.each(["http://assets.example/a.png", "https://unlisted.example/a.png"])(
    "rejects a non-HTTPS or non-allowlisted source: %s",
    async (url) => {
      await expect(downloadAsset(
        { ...baseAsset, url },
        {
          outputRoot: mkdtempSync(join(tmpdir(), "offline-wiki-assets-")),
          allowedHosts: ["assets.example"],
          fetchImpl: async () => { throw new Error("network must not be reached"); },
        },
      )).rejects.toThrow(/https|allowlist/i);
    },
  );

  it("rejects a redirect to a host outside the allowlist", async () => {
    await expect(downloadAsset(baseAsset, {
      outputRoot: mkdtempSync(join(tmpdir(), "offline-wiki-assets-")),
      allowedHosts: ["assets.example"],
      fetchImpl: async () => new Response(null, {
        status: 302,
        headers: { location: "https://evil.example/stolen.png" },
      }),
    })).rejects.toThrow(/redirect.*allowlist/i);
  });

  it("rejects a response exceeding the byte ceiling before caching it", async () => {
    await expect(downloadAsset(baseAsset, {
      outputRoot: mkdtempSync(join(tmpdir(), "offline-wiki-assets-")),
      allowedHosts: ["assets.example"],
      maxBytes: 3,
      fetchImpl: async () => new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": "4" },
      }),
    })).rejects.toThrow(/byte limit/i);
  });

  it("rejects bytes whose file signature does not match the declared image type", async () => {
    await expect(downloadAsset(baseAsset, {
      outputRoot: mkdtempSync(join(tmpdir(), "offline-wiki-assets-")),
      allowedHosts: ["assets.example"],
      fetchImpl: async () => new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": "3" },
      }),
    })).rejects.toThrow(/signature/i);
  });

  it("caches an allowed image under its safe cache key", async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "offline-wiki-assets-"));
    const pngSignature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const result = await downloadAsset(baseAsset, {
      outputRoot,
      allowedHosts: ["assets.example"],
      fetchImpl: async () => new Response(pngSignature, {
        status: 200,
        headers: { "content-type": "image/png", "content-length": "8" },
      }),
    });

    expect(result.path).toBe(join(outputRoot, "character-1.png"));
    expect(existsSync(result.path)).toBe(true);
    expect([...readFileSync(result.path)]).toEqual([...pngSignature]);
    expect(result.checksum).toMatch(/^sha256:[a-f0-9]{64}$/);
  });
});
