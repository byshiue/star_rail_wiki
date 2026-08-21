import { afterEach, describe, expect, it, vi } from "vitest";
import entitiesFixture from "../../data/fixtures/release-4.3/entities.json";
import releaseFixture from "../../data/fixtures/release-4.3/release.json";
import { loadRelease, loadReleaseIndex } from "./releaseRepository";

afterEach(() => vi.unstubAllGlobals());

describe("release repository", () => {
  it("loads and validates the release index", async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      currentReleaseId: "4.3-fixture", releases: [releaseFixture],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchStub);

    await expect(loadReleaseIndex()).resolves.toMatchObject({ currentReleaseId: "4.3-fixture" });
    expect(fetchStub).toHaveBeenCalledWith("/data/releases/index.json");
  });

  it("encodes the release ID and validates the assembled bundle", async () => {
    const fetchStub = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(releaseFixture), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(entitiesFixture), { status: 200 }));
    vi.stubGlobal("fetch", fetchStub);

    const bundle = await loadRelease("4.3 fixture/评审");

    expect(bundle.release.id).toBe("4.3-fixture");
    expect(fetchStub).toHaveBeenNthCalledWith(
      1,
      "/data/releases/4.3%20fixture%2F%E8%AF%84%E5%AE%A1/release.json",
    );
  });

  it("rejects malformed release data returned by fetch", async () => {
    const fetchStub = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...releaseFixture, channel: "preload" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(entitiesFixture), { status: 200 }));
    vi.stubGlobal("fetch", fetchStub);

    await expect(loadRelease("4.3-fixture")).rejects.toThrow();
  });

  it("rejects an unsuccessful HTTP response before parsing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    await expect(loadReleaseIndex()).rejects.toThrow("Failed to fetch release data (404)");
  });
});
