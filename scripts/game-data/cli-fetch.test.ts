import { execFile } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { fetchSource } from "./fetchSource";

const execute = promisify(execFile);
const fixtureRoot = path.resolve("scripts/game-data/__fixtures__/source");

it("fetches an immutable revision path and verifies the reviewed checksum", async () => {
  const server = createServer((request, response) => {
    if (request.url === "/93fa10b7/index_new/cn/characters.json") {
      response.end('[{"name":"完整中文文本"}]');
      return;
    }
    response.writeHead(404).end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind a TCP port");
  const manifest = {
    releaseId: "fixture",
    gameVersion: "4.3",
    channel: "released" as const,
    importedAt: "2026-08-21T00:00:00.000Z",
    reviewedAt: null,
    previousReleaseId: null,
    sources: [{
      name: "HTTP fixture",
      baseUrl: `http://127.0.0.1:${address.port}`,
      revision: "93fa10b7",
      gameVersion: "4.3",
      channel: "released" as const,
      retrievedAt: "2026-08-21T00:00:00.000Z",
      fileChecksums: {
        "index_new/cn/characters.json": "sha256:fb47376147a3f05eaaa23a8cc830ef2718faced8e8a54ff2ebddbec162b9f138",
      },
    }],
  };

  try {
    const fetched = await fetchSource(manifest);
    expect(fetched.files.get("index_new/cn/characters.json")?.value).toEqual([{ name: "完整中文文本" }]);
  } finally {
    server.close();
  }
});

it("provides an honest CLI that requires the reviewed manifest and fixture root", async () => {
  const output = await mkdtemp(path.join(tmpdir(), "star-rail-cli-"));
  await execute(
    "npm",
    ["run", "data:import", "--", "--version", "4.3", "--source-revision", "d5c40c00", "--manifest", path.join(fixtureRoot, "manifest.json"), "--source-root", fixtureRoot, "--overlays", path.join(fixtureRoot, "effects.json"), "--output", output],
    { cwd: process.cwd() },
  );

  expect(JSON.parse(await readFile(path.join(output, "release.json"), "utf8"))).toMatchObject({
    id: "4.3-reviewed-local-fixture",
    gameVersion: "4.3",
  });
});
