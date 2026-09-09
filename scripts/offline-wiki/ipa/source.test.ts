import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import type { DecodedTextMap } from "./text-map";
import { loadPinnedMapping, mergeVerifiedTextMaps, parseMappingRows, type PinnedMappingConfig } from "./source";

const requiredPaths = ["TextMap/TextMapCHS.json", "ExcelOutput/StoryAtlas.json"];

function repository(overrides: Record<string, string> = {}): { root: string; revision: string } {
  const root = mkdtempSync(join(tmpdir(), "hsr-mapping-fixture-"));
  const files = {
    "TextMap/TextMapCHS.json": JSON.stringify({ "2": "完整正文", "3": "补充正文" }),
    "ExcelOutput/StoryAtlas.json": "[]",
    ...overrides,
  };
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "OSPRODWin4.5.0 fixture"], { cwd: root });
  return { root, revision: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim() };
}

function config(revision: string, overrides: Partial<PinnedMappingConfig> = {}): PinnedMappingConfig {
  return {
    repositoryUrl: "https://gitlab.com/Dimbreath/turnbasedgamedata.git",
    revision,
    gameVersion: "4.5",
    releaseMarker: "OSPRODWin4.5.0",
    requiredPaths,
    ...overrides,
  };
}

function ipaText(text = "完整正文"): DecodedTextMap {
  return {
    entries: new Map([["2", { legacyHash: "1", text, parameterized: false }]]),
    primaryCount: 1,
    indexCount: 1,
  };
}

describe("pinned 4.5 mapping source", () => {
  it("loads only the exact commit and records checksums for every required file", () => {
    const fixture = repository();
    const loaded = loadPinnedMapping(fixture.root, config(fixture.revision));

    expect(loaded.revision).toBe(fixture.revision);
    expect(loaded.gameVersion).toBe("4.5");
    expect(loaded.textMap.get("2")).toBe("完整正文");
    expect(loaded.tables.get("ExcelOutput/StoryAtlas.json")).toEqual([]);
    expect([...loaded.fileChecksums]).toEqual([
      ["ExcelOutput/StoryAtlas.json", expect.stringMatching(/^sha256:[a-f0-9]{64}$/)],
      ["TextMap/TextMapCHS.json", expect.stringMatching(/^sha256:[a-f0-9]{64}$/)],
    ]);
  });

  it("rejects a different commit, version marker, or missing required table", () => {
    const fixture = repository();
    expect(() => loadPinnedMapping(fixture.root, config("a".repeat(40)))).toThrow(/revision/i);
    expect(() => loadPinnedMapping(fixture.root, config(fixture.revision, { releaseMarker: "OSPRODWin4.4.0" }))).toThrow(/release marker/i);
    expect(() => loadPinnedMapping(fixture.root, config(fixture.revision, { requiredPaths: [...requiredPaths, "ExcelOutput/Missing.json"] }))).toThrow(/Missing\.json/);
  });

  it("requires every overlapping hash to match the IPA text exactly", () => {
    const fixture = repository();
    const loaded = loadPinnedMapping(fixture.root, config(fixture.revision));
    expect(() => mergeVerifiedTextMaps(ipaText("被修改"), loaded.textMap)).toThrow(/conflict.*2/i);

    const merged = mergeVerifiedTextMaps(ipaText(), loaded.textMap);
    expect(merged.overlapCount).toBe(1);
    expect(merged.ipaOnlyCount).toBe(0);
    expect(merged.supplementOnlyCount).toBe(1);
    expect(merged.entries).toEqual(new Map([["2", "完整正文"], ["3", "补充正文"]]));
  });
  it("can explicitly prefer the official release text and audits conflicts without copying either body", () => {
    const fixture = repository();
    const loaded = loadPinnedMapping(fixture.root, config(fixture.revision));
    const merged = mergeVerifiedTextMaps(ipaText("IPA 预载正文"), loaded.textMap, {
      conflictPolicy: "prefer-supplement",
    });

    expect(merged.entries.get("2")).toBe("完整正文");
    expect(merged.overlapCount).toBe(1);
    expect(merged.conflicts).toEqual([
      {
        hash: "2",
        ipaChecksum: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        supplementChecksum: expect.stringMatching(/^sha256:[a-f0-9]{64}$/),
        ipaBytes: Buffer.byteLength("IPA 预载正文"),
        supplementBytes: Buffer.byteLength("完整正文"),
      },
    ]);
    expect(JSON.stringify(merged.conflicts)).not.toContain("IPA 预载正文");
    expect(JSON.stringify(merged.conflicts)).not.toContain("完整正文");
  });
  it("preserves unsigned 64-bit Hash values while parsing mapping tables", () => {
    const rows = parseMappingRows(Buffer.from('[{"ID":1,"Story":{"Hash":1842400890577956033}}]'));
    expect(rows).toEqual([{ ID: 1, Story: { Hash: "1842400890577956033" } }]);
  });
});
