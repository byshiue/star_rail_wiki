import { describe, expect, it } from "vitest";
import { convertHsrScannerJson } from "./hsrScanner";

function scanner(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    source: "HSR-Scanner",
    build: "v1.5.0",
    version: 4,
    metadata: { uid: null, trailblazer: "Stelle" },
    characters: [{
      id: "1001", name: "三月七", path: "Preservation", level: 80,
      ascension: 6, eidolon: 4, skills: {}, traces: {},
    }],
    light_cones: [
      { id: "20000", name: "锋镝", level: 80, ascension: 6, superimposition: 5,
        location: "", lock: true, _uid: "cone-a" },
      { id: "20000", name: "锋镝", level: 70, ascension: 5, superimposition: 1,
        location: "1001", lock: false, _uid: "cone-b" },
    ],
    relics: [{ set_id: "101", name: "套装", slot: "Head", rarity: 5, level: 15,
      mainstat: "HP", substats: [], preview_substats: [], location: "1001",
      lock: true, discard: false, _uid: "relic-a" }],
    ...overrides,
  });
}

describe("HSR-Scanner conversion", () => {
  it("maps canonical IDs, preserves equipment instances, and records minimal provenance", () => {
    const converted = convertHsrScannerJson(scanner(), {
      uid: "100000001", dataReleaseId: "4.4-cn-2026-08-21",
      importedAt: "2026-08-22T00:00:00.000Z",
    });

    expect(converted.characters).toEqual([
      { logicalId: "character:1001", eidolon: 4, level: 80 },
    ]);
    expect(converted.lightCones).toEqual([
      { instanceId: "hsr-scanner:light-cone:cone-a", logicalId: "light-cone:20000", superimposition: 5, level: 80 },
      { instanceId: "hsr-scanner:light-cone:cone-b", logicalId: "light-cone:20000", superimposition: 1, level: 70 },
    ]);
    expect(converted.relics).toEqual([
      { instanceId: "hsr-scanner:relic:relic-a", setLogicalId: "relic-set:101", slot: "Head" },
    ]);
    expect(converted.inventorySources).toEqual([{
      kind: "hsr-scanner", build: "v1.5.0", formatVersion: 4,
      importedAt: "2026-08-22T00:00:00.000Z",
      counts: { characters: 1, lightCones: 2, relics: 1 },
    }]);
  });

  it("requires an explicit target UID when metadata UID is null", () => {
    expect(() => convertHsrScannerJson(scanner(), {
      uid: "", dataReleaseId: "4.4-cn-2026-08-21", importedAt: "2026-08-22T00:00:00.000Z",
    })).toThrow(/UID/i);
  });

  it("rejects a non-null scanner UID that differs from the explicit target", () => {
    expect(() => convertHsrScannerJson(scanner({ metadata: { uid: "100000002", trailblazer: "Stelle" } }), {
      uid: "100000001", dataReleaseId: "4.4-cn-2026-08-21",
      importedAt: "2026-08-22T00:00:00.000Z",
    })).toThrow(/UID.*match/i);
  });

  it("rejects malformed and unsupported scanner documents without partial output", () => {
    expect(() => convertHsrScannerJson("{bad", {
      uid: "100000001", dataReleaseId: "4.4-cn-2026-08-21", importedAt: "2026-08-22T00:00:00.000Z",
    })).toThrow(/malformed/i);
    expect(() => convertHsrScannerJson(scanner({ version: 5 }), {
      uid: "100000001", dataReleaseId: "4.4-cn-2026-08-21", importedAt: "2026-08-22T00:00:00.000Z",
    })).toThrow(/version|literal/i);
  });
});
