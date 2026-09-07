import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadDocumentCatalog } from "./catalog";
import { compareDocumentCatalogs } from "./changes";

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "releases");

describe("offline wiki release changes", () => {
  it("classifies content changes while ignoring revision metadata", () => {
    const previous = loadDocumentCatalog(fixtureRoot, "4.4-fixture");
    const current = structuredClone(previous);
    current.release.id = "4.5-fixture";
    current.release.gameVersion = "4.5";
    current.characters[0]!.description = "角色说明发生变化。";
    current.lightCones = [];

    expect(compareDocumentCatalogs(previous, current)).toEqual({
      baselineReleaseId: "4.4-fixture",
      added: [],
      changed: ["character:1"],
      unchanged: ["relic-set:1"],
      removed: ["light-cone:1"],
    });
  });

  it("classifies every current entity as added when no baseline exists", () => {
    const current = loadDocumentCatalog(fixtureRoot, "4.4-fixture");
    expect(compareDocumentCatalogs(null, current).added).toEqual([
      "character:1",
      "light-cone:1",
      "relic-set:1",
    ]);
  });
});
