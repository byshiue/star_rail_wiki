import { describe, expect, it } from "vitest";
import { validateTrackedFiles } from "./repository-hygiene";

describe("offline wiki repository hygiene", () => {
  it.each([
    ".local/offline-wiki/builds/4.4/book.pdf",
    ".local/offline-wiki/assets/a.webp",
    ".local/offline-wiki/drafts/a.json",
    "data/offline-wiki/official-art/character.png",
    "data/offline-wiki/summaries/character.draft.json",
  ])("rejects a tracked local or unreviewed artifact: %s", (path) => {
    expect(validateTrackedFiles([path])).toEqual([path]);
  });

  it("allows source manifests, reviewed JSON, generator code, and documentation", () => {
    expect(validateTrackedFiles([
      "data/offline-wiki/assets.json",
      "data/offline-wiki/summaries/characters.json",
      "scripts/offline-wiki/build.ts",
      "docs/offline-wiki.md",
    ])).toEqual([]);
  });
});
