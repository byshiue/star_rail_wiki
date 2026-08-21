import { once } from "node:events";
import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
    releaseId: "resolved-url-security-fixture",
    gameVersion: "4.3",
    channel: "released",
    importedAt: "2026-08-21T00:00:00.000Z",
    reviewedAt: null,
    previousReleaseId: null,
    sources: [{
      name: "Resolved URL fixture",
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

beforeAll(async () => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind a TCP port");
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  server.close();
  await once(server, "close");
});

describe("resolved immutable source URLs", () => {
  it.each([
    ["master in baseUrl", () => manifest(`${origin}/master`), /mutable.*master|master.*mutable/i],
    ["latest in baseUrl", () => manifest(`${origin}/latest`), /mutable.*latest|latest.*mutable/i],
    ["encoded master path", () => manifest(`${origin}/%6daster`), /mutable.*master|master.*mutable/i],
    ["encoded latest path", () => manifest(`${origin}/%6catest`), /mutable.*latest|latest.*mutable/i],
    ["encoded mutable query ref", () => manifest(origin, "{baseUrl}/{revision}/{path}?ref=%6daster"), /mutable.*master|master.*mutable/i],
    ["revision only in unrelated query", () => manifest(origin, "{baseUrl}/{path}?reviewed={revision}"), /revision.*path|path.*revision/i],
  ])("rejects %s before network I/O", async (_label, makeManifest, expected) => {
    await expect(fetchSource(makeManifest())).rejects.toThrow(expected);
    expect(requests).toBe(0);
  });

  it("allows legitimate substrings and non-ref query values when revision is a path segment", async () => {
    const source = manifest(
      `${origin}/mastery/latest-data`,
      "{baseUrl}/{revision}/{path}?name=master",
    );

    const fetched = await fetchSource(source);

    expect(fetched.files.get("index_new/cn/characters.json")?.value).toEqual([{ ok: true }]);
    expect(requests).toBe(1);
  });
});
