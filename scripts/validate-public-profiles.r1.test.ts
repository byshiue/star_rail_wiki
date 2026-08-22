import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { GameReleaseBundle, ReleaseIndex } from "../src/domain/releases";
import { validatePublicProfileFile, validatePublicProfileIndex, validatePublicProfileRepository, type PublicProfileReferenceContext } from "./validate-public-profiles";

const temporaryRoots: string[] = [];
afterEach(async () => { await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

const released = { id: "release-4.3", gameVersion: "4.3", region: "cn" as const, channel: "released" as const, importedAt: "2026-08-20T00:00:00.000Z", reviewedAt: "2026-08-20T00:30:00.000Z", sources: [{ name: "source", url: "https://example.com", revision: "12345678", fileChecksums: { a: "x" }, retrievedAt: "2026-08-20T00:00:00.000Z" }], previousReleaseId: null };
const bundle = { release: released, entities: { characters: [{ logicalId: "character:a", validToReleaseId: null }], equipment: [{ logicalId: "light-cone:a", kind: "light-cone", validToReleaseId: null }, { logicalId: "relic-set:a", kind: "relic-set", validToReleaseId: null }], effects: [] } } as unknown as GameReleaseBundle;
const context: PublicProfileReferenceContext = { releaseIndex: { currentReleaseId: released.id, releases: [released] } satisfies ReleaseIndex, bundles: new Map([[released.id, bundle]]) };
const valid = { schemaVersion: 1, uid: "100000001", releaseId: released.id, updatedAt: "2026-08-20T01:00:00.000Z", publication: { visibility: "public", consentedAt: "2026-08-20T02:00:00.000Z" }, characters: [{ logicalId: "character:a", eidolon: 0, level: 1 }], lightCones: [{ logicalId: "light-cone:a", superimposition: 1, level: 1 }], relics: [{ setLogicalId: "relic-set:a", slot: "head" }] };

describe("R1 strict public index contract", () => {
  it.each(["token", "cookie", "unexpected"])("rejects index field %s through the shared strict schema", (field) => {
    const issues = validatePublicProfileIndex({ schemaVersion: 1, profiles: [], [field]: field === "unexpected" ? true : "not-a-real-secret" }, new Map());
    expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: field === "unexpected" ? "invalid_index" : "secret" })]));
    expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "invalid_index" })]));
  });

  it("recursively rejects credential fields nested inside an invalid index entry", () => {
    const issues = validatePublicProfileIndex({ schemaVersion: 1, profiles: [{ uid: "100000001", path: "100000001.json", updatedAt: valid.updatedAt, metadata: { cookie: "not-real" } }] }, new Map());
    expect(issues).toEqual(expect.arrayContaining([expect.objectContaining({ code: "secret", path: expect.stringContaining("cookie") }), expect.objectContaining({ code: "invalid_index" })]));
  });
});

describe("R1 reference and repository validation", () => {
  it("rejects unreleased releases and wrong-kind cross references", () => {
    const fixtureRelease = { ...released, id: "fixture-release", channel: "fixture" as const };
    const fixtureBundle = { ...bundle, release: fixtureRelease } as GameReleaseBundle;
    const fixtureContext: PublicProfileReferenceContext = { releaseIndex: { currentReleaseId: null, releases: [fixtureRelease] }, bundles: new Map([[fixtureRelease.id, fixtureBundle]]) };
    expect(validatePublicProfileFile("public/profiles/100000001.json", { ...valid, releaseId: fixtureRelease.id }, fixtureContext)).toEqual(expect.arrayContaining([expect.objectContaining({ code: "unreleased_release" })]));
    expect(validatePublicProfileFile("public/profiles/100000001.json", { ...valid, characters: [{ logicalId: "light-cone:a", eidolon: 0, level: 1 }], lightCones: [{ logicalId: "relic-set:a", superimposition: 1, level: 1 }] }, context)).toEqual(expect.arrayContaining([expect.objectContaining({ code: "unknown_character" }), expect.objectContaining({ code: "unknown_equipment" })]));
  });

  it("reports non-JSON, nested, and orphan files in one repository pass", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "public-profiles-r1-")); temporaryRoots.push(root);
    await mkdir(path.join(root, "public/profiles/nested"), { recursive: true });
    await symlink(path.resolve("public/data"), path.join(root, "public/data"), "dir");
    await writeFile(path.join(root, "public/profiles/index.json"), JSON.stringify({ schemaVersion: 1, profiles: [] }));
    await writeFile(path.join(root, "public/profiles/100000001.json"), "{not json");
    await writeFile(path.join(root, "public/profiles/nested/100000002.json"), JSON.stringify(valid));
    await writeFile(path.join(root, "public/profiles/100000003.json"), JSON.stringify({ ...valid, uid: "100000003", releaseId: "4.3-fixture" }));

    await expect(validatePublicProfileRepository(root)).rejects.toThrow(/invalid_profile.*invalid_path.*unindexed_profile_file/s);
  });
});
