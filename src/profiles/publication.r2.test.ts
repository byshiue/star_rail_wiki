import { afterEach, describe, expect, it, vi } from "vitest";
import type { AccountProfile } from "../domain/profiles";
import { createPublicProfileExport, loadPublicProfile, PublicAccountProfileSchema } from "./publication";

const updatedAt = "2026-08-20T00:00:00.000Z";
const consentedAt = "2026-08-20T01:00:00.000Z";
const localProfile: AccountProfile = {
  schemaVersion: 1, uid: "100000001", dataReleaseId: "release-4.3", updatedAt,
  characters: [], lightCones: [], relics: [],
};
const publicProfile = {
  schemaVersion: 1 as const, uid: localProfile.uid, releaseId: localProfile.dataReleaseId, updatedAt,
  publication: { visibility: "public" as const, consentedAt },
  characters: [], lightCones: [], relics: [],
};

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("R2 clock-independent public content", () => {
  it("lets a visitor whose clock is ten minutes slow read valid merged content", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T00:50:00.000Z"));
    expect(PublicAccountProfileSchema.parse(publicProfile)).toEqual(publicProfile);
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ schemaVersion: 1, profiles: [{ uid: publicProfile.uid, path: `${publicProfile.uid}.json`, updatedAt }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => publicProfile }));

    await expect(loadPublicProfile(publicProfile.uid)).resolves.toEqual(publicProfile);
  });

  it("still rejects artifact creation when consent is more than five minutes ahead", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-20T00:50:00.000Z"));
    expect(() => createPublicProfileExport(localProfile, consentedAt)).toThrow(/future/i);
  });
});
