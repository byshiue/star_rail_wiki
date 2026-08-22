import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("StarRailRes distribution compliance", () => {
  it("ships the complete AGPL-3.0 text and a precise corresponding-source notice", async () => {
    const license = await readFile("THIRD_PARTY_LICENSES/AGPL-3.0.txt", "utf8");
    const notice = await readFile("NOTICE", "utf8");
    expect(license).toContain("GNU AFFERO GENERAL PUBLIC LICENSE");
    expect(license).toContain("Version 3, 19 November 2007");
    expect(license).toContain("END OF TERMS AND CONDITIONS");
    expect(license.split("\n").length).toBeGreaterThan(650);
    expect(notice).toContain("public/data/releases/4.3-cn-2026-06-10/");
    expect(notice).toContain("public/data/releases/4.4-cn-2026-08-21/");
    expect(notice).toContain("scripts/game-data/");
    expect(notice).toContain("7b349e39ee0f6f3bf814567995829b99c95e7a93");
    expect(notice).toContain("b95e75c7e1273d819d20c530c0b7e13a3ef19fb4");
    expect(notice).toContain("corresponding source");
  });
});
