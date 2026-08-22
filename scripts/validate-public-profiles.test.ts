import { describe, expect, it } from "vitest";
import type { GameReleaseBundle, ReleaseIndex } from "../src/domain/releases";
import {
  validatePublicProfileFile,
  validatePublicProfileIndex,
  type PublicProfileReferenceContext,
} from "./validate-public-profiles";

const release = {
  id: "release-4.3", gameVersion: "4.3", region: "cn" as const, channel: "released" as const,
  importedAt: "2026-08-21T00:00:00.000Z", reviewedAt: "2026-08-21T00:30:00.000Z",
  sources: [{ name: "source", url: "https://example.com/data", revision: "12345678", fileChecksums: { a: "sha256:x" }, retrievedAt: "2026-08-21T00:00:00.000Z" }],
  previousReleaseId: null,
};
const bundle = {
  release,
  entities: {
    characters: [{ logicalId: "character:a", validToReleaseId: null }],
    equipment: [
      { logicalId: "light-cone:a", kind: "light-cone", validToReleaseId: null },
      { logicalId: "relic-set:a", kind: "relic-set", validToReleaseId: null },
    ],
    effects: [],
  },
} as unknown as GameReleaseBundle;
const releaseIndex = { currentReleaseId: "release-4.3", releases: [release] } satisfies ReleaseIndex;
const context: PublicProfileReferenceContext = { releaseIndex, bundles: new Map([[release.id, bundle]]) };
const valid = {
  schemaVersion: 1, uid: "100000001", releaseId: "release-4.3",
  updatedAt: "2026-08-21T01:00:00.000Z", consentAt: "2026-08-21T02:00:00.000Z",
  characters: [{ logicalId: "character:a", eidolon: 2, level: 80 }],
  lightCones: [{ logicalId: "light-cone:a", superimposition: 1, level: 80 }],
  relics: [{ setLogicalId: "relic-set:a", slot: "head" }],
};

describe("public profile file validation", () => {
  it("accepts the exact checked-in path and known released references", () => {
    expect(validatePublicProfileFile("public/profiles/100000001.json", valid, context)).toEqual([]);
  });

  it("rejects mismatched, traversing, nested, and non-json paths", () => {
    expect(validatePublicProfileFile("public/profiles/100000002.json", valid, context)).toEqual(expect.arrayContaining([expect.objectContaining({ code: "uid_path_mismatch" })]));
    for (const file of ["public/profiles/../100000001.json", "public/profiles/nested/100000001.json", "public/profiles/100000001.txt"]) {
      expect(validatePublicProfileFile(file, valid, context)).toEqual(expect.arrayContaining([expect.objectContaining({ code: "invalid_path" })]));
    }
  });

  it.each([
    [{ ...valid, consentAt: undefined }, "invalid_profile"],
    [{ ...valid, label: "private" }, "unexpected_field"],
    [{ ...valid, token: "ghp_not_a_real_token" }, "secret"],
    [{ ...valid, releaseId: "unknown" }, "unknown_release"],
    [{ ...valid, characters: [{ logicalId: "character:unknown", eidolon: 0, level: 1 }] }, "unknown_character"],
    [{ ...valid, lightCones: [{ logicalId: "light-cone:unknown", superimposition: 1, level: 1 }] }, "unknown_equipment"],
    [{ ...valid, relics: [{ setLogicalId: "relic-set:unknown", slot: "head" }] }, "unknown_equipment"],
  ])("rejects invalid or private payloads with %s", (payload, code) => {
    expect(validatePublicProfileFile("public/profiles/100000001.json", payload, context)).toEqual(expect.arrayContaining([expect.objectContaining({ code })]));
  });

  it("rejects duplicate inventory IDs and oversized files", () => {
    expect(validatePublicProfileFile("public/profiles/100000001.json", {
      ...valid, characters: [...valid.characters, ...valid.characters],
    }, context)).toEqual(expect.arrayContaining([expect.objectContaining({ code: "duplicate_reference" })]));
    expect(validatePublicProfileFile("public/profiles/100000001.json", valid, context, 1024 * 1024 + 1))
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: "file_too_large" })]));
  });
});

describe("public profile index validation", () => {
  it("rejects unsupported versions, duplicate UIDs, missing files, and unindexed files", () => {
    const files = new Map([
      ["public/profiles/100000001.json", valid],
      ["public/profiles/100000003.json", { ...valid, uid: "100000003" }],
    ]);
    expect(validatePublicProfileIndex({ schemaVersion: 2, profiles: [
      { uid: "100000001", path: "100000001.json", updatedAt: valid.updatedAt },
      { uid: "100000001", path: "100000002.json", updatedAt: valid.updatedAt },
    ] }, files)).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "unsupported_index_version" }),
      expect.objectContaining({ code: "duplicate_uid" }),
      expect.objectContaining({ code: "missing_profile_file" }),
      expect.objectContaining({ code: "unindexed_profile_file" }),
    ]));
  });
});
