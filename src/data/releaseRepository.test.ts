import { afterEach, describe, expect, it, vi } from "vitest";
import entitiesFixture from "../../data/fixtures/release-4.3/entities.json";
import releaseFixture from "../../data/fixtures/release-4.3/release.json";
import { loadRelease, loadReleaseIndex } from "./releaseRepository";

afterEach(() => vi.unstubAllGlobals());

function releaseIndexFor(...releases: Array<typeof releaseFixture>) {
  return {
    currentReleaseId: releases[0].channel === "released" ? releases[0].id : null, releases,
  };
}

describe("release repository", () => {
  it("loads and validates the release index", async () => {
    const released = structuredClone(releaseFixture);
    released.id = "4.3-reviewed";
    released.channel = "released";
    released.sources[0].name = "Reviewed upstream source";
    released.sources[0].url = "https://example.com/star-rail-reviewed";
    const fetchStub = vi.fn().mockResolvedValue(new Response(
      JSON.stringify(releaseIndexFor(released)),
      { status: 200 },
    ));
    vi.stubGlobal("fetch", fetchStub);

    await expect(loadReleaseIndex()).resolves.toMatchObject({ currentReleaseId: "4.3-reviewed" });
    expect(fetchStub).toHaveBeenCalledWith("/data/releases/index.json");
  });

  it("rejects a fixture selected as current through the shared runtime schema", async () => {
    const fetchStub = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      currentReleaseId: releaseFixture.id,
      releases: [releaseFixture],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchStub);

    await expect(loadReleaseIndex()).rejects.toThrow(/current.*released/i);
  });

  it("encodes the release ID independently while accepting a matching response", async () => {
    const requestedId = "4.3 fixture/评审";
    const requestedRelease = { ...releaseFixture, id: requestedId };
    const fetchStub = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(requestedRelease), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(entitiesFixture), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(
        releaseIndexFor(requestedRelease, releaseFixture),
      ), { status: 200 }));
    vi.stubGlobal("fetch", fetchStub);

    await expect(loadRelease(requestedId)).resolves.toMatchObject({ release: { id: requestedId } });
    expect(fetchStub).toHaveBeenNthCalledWith(
      1,
      "/data/releases/4.3%20fixture%2F%E8%AF%84%E5%AE%A1/release.json",
    );
  });

  it("rejects a response release ID that differs from the requested ID", async () => {
    const fetchStub = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(releaseFixture), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(entitiesFixture), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(releaseIndexFor(releaseFixture)), { status: 200 }));
    vi.stubGlobal("fetch", fetchStub);

    await expect(loadRelease("different-release")).rejects.toThrow(/does not match requested release/);
  });

  it("rejects entity release references absent from the release index", async () => {
    const entities = structuredClone(entitiesFixture);
    entities.characters[0].validFromReleaseId = "missing-release";
    const fetchStub = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(releaseFixture), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(entities), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(releaseIndexFor(releaseFixture)), { status: 200 }));
    vi.stubGlobal("fetch", fetchStub);

    await expect(loadRelease("4.3-fixture")).rejects.toThrow(/unknown releaseId/);
  });

  it("rejects a bundle without exactly one active revision per kind and logical ID", async () => {
    const entities = structuredClone(entitiesFixture);
    const duplicate = structuredClone(entities.equipment[0]);
    duplicate.revisionId = "light-cone:synthetic-cone@duplicate-active";
    duplicate.effectIds = [];
    entities.equipment.push(duplicate);
    const fetchStub = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(releaseFixture), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(entities), { status: 200 }))
      .mockResolvedValueOnce(new Response(
        JSON.stringify(releaseIndexFor(releaseFixture)),
        { status: 200 },
      ));
    vi.stubGlobal("fetch", fetchStub);

    await expect(loadRelease("4.3-fixture")).rejects.toThrow(/exactly one active revision/i);
  });

  it("rejects malformed release data returned by fetch", async () => {
    const fetchStub = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...releaseFixture, channel: "preload" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(entitiesFixture), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(releaseIndexFor(releaseFixture)), { status: 200 }));
    vi.stubGlobal("fetch", fetchStub);

    await expect(loadRelease("4.3-fixture")).rejects.toThrow();
  });

  it("rejects an unsuccessful HTTP response before parsing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    await expect(loadReleaseIndex()).rejects.toThrow("Failed to fetch release data (404)");
  });
});
