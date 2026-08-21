import { once } from "node:events";
import { createServer } from "node:http";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { fetchSource } from "./fetchSource";
import type { ApprovedSourceManifest } from "./sourceManifest";

const responseBody = '[{"ok":true}]';
const responseChecksum = "sha256:e18bfe6707d979ac0efa651ae9559756ab781e4355560127c4f717271ceef2b2";
let origin = "";
let requests = 0;

const server = createServer((_request, response) => {
  requests += 1;
  response.end(responseBody);
});

function manifest(baseUrl: string, downloadUrlTemplate?: string): ApprovedSourceManifest {
  return {
    releaseId: "deep-encoding-security-fixture",
    gameVersion: "4.3",
    channel: "released",
    importedAt: "2026-08-21T00:00:00.000Z",
    reviewedAt: null,
    previousReleaseId: null,
    sources: [{
      name: "Deep encoding fixture",
      baseUrl,
      revision: "93fa10b7",
      gameVersion: "4.3",
      channel: "released",
      retrievedAt: "2026-08-21T00:00:00.000Z",
      ...(downloadUrlTemplate ? { downloadUrlTemplate } : {}),
      fileChecksums: { "index_new/cn/characters.json": responseChecksum },
    }],
  };
}

function encodePercent(value: string, additionalPasses: number): string {
  let encoded = value;
  for (let pass = 0; pass < additionalPasses; pass += 1) encoded = encoded.replaceAll("%", "%25");
  return encoded;
}

beforeAll(async () => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind a TCP port");
  origin = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  requests = 0;
});

afterAll(async () => {
  server.close();
  await once(server, "close");
});

describe("deeply encoded immutable source URLs", () => {
  it.each([
    ["four-times encoded master path", () => manifest(`${origin}/%2525256daster`), /mutable.*master|master.*mutable/i],
    ["four-times encoded latest path", () => manifest(`${origin}/%2525256catest`), /mutable.*latest|latest.*mutable/i],
    ["deeper encoded master query ref", () => manifest(origin, "{baseUrl}/{revision}/{path}?ref=%252525256daster"), /mutable.*master|master.*mutable/i],
    ["deeper encoded latest query ref", () => manifest(origin, "{baseUrl}/{revision}/{path}?branch=%252525256catest"), /mutable.*latest|latest.*mutable/i],
    ["encoding deeper than the safety bound", () => manifest(`${origin}/${encodePercent("%6daster", 12)}`), /excessive.*percent|percent.*excessive/i],
    ["malformed percent encoding", () => manifest(`${origin}/%ZZ`), /invalid percent encoding/i],
  ])("rejects %s without a network request", async (_label, makeManifest, expected) => {
    await expect(fetchSource(makeManifest())).rejects.toThrow(expected);
    expect(requests).toBe(0);
  });

  it("preserves ordinary encoded text and legitimate mutable-like substrings", async () => {
    const source = manifest(
      `${origin}/%E4%B8%AD%E6%96%87/mastery/latest-data`,
      "{baseUrl}/{revision}/{path}?name=latest",
    );

    const fetched = await fetchSource(source);

    expect(fetched.files.get("index_new/cn/characters.json")?.value).toEqual([{ ok: true }]);
    expect(requests).toBe(1);
  });
});
