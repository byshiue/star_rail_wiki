import { describe, expect, it } from "vitest";
import { validatePublicProfileFile } from "./validate-public-profiles";

describe("R2 submission-time clock policy", () => {
  it("rejects a consent timestamp more than five minutes ahead of the CI clock", () => {
    const profile = {
      schemaVersion: 1, uid: "100000001", releaseId: "release-4.3",
      updatedAt: "2026-08-20T00:00:00.000Z",
      publication: { visibility: "public", consentedAt: "2026-08-20T01:00:00.000Z" },
      characters: [], lightCones: [], relics: [],
    };

    expect(validatePublicProfileFile(
      "public/profiles/100000001.json", profile, undefined, JSON.stringify(profile).length,
      Date.parse("2026-08-20T00:50:00.000Z"),
    )).toEqual(expect.arrayContaining([expect.objectContaining({ code: "future_consent" })]));
  });
});
