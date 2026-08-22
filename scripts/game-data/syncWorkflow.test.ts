import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("released data sync workflow", () => {
  it("discovers released-only immutable evidence and opens a draft PR from a branch", async () => {
    const workflow = await readFile(".github/workflows/sync-game-data.yml", "utf8");
    expect(workflow).toContain("discoverReleasedVersion.ts");
    expect(workflow).toContain("no-change");
    expect(workflow).toContain(".currentReleaseId");
    expect(workflow).toContain("npm run check");
    expect(workflow).toContain("git switch -c");
    expect(workflow).toContain("gh pr create --draft");
    expect(workflow).toContain("contents: write");
    expect(workflow).toContain("pull-requests: write");
    expect(workflow).not.toContain("create-pull-request");
    expect(workflow).not.toMatch(/push origin (?:main|HEAD:main)/);
    expect(workflow).not.toMatch(/deploy|pages|preload|beta|master/i);
    expect(workflow).not.toContain("secrets.");
    expect(workflow).not.toContain("pull_request:");
  });

  it("uses the public official feed and full commit SHAs without credentials", async () => {
    const source = await readFile("scripts/game-data/discoverReleasedVersion.ts", "utf8");
    expect(source).toContain("bbs-api-os.hoyolab.com");
    expect(source).toContain("Update Details");
    expect(source).toContain("DimbreathBot/TurnBasedGameData");
    expect(source).toContain("Mar-7th/StarRailRes");
    expect(source).toContain("^[a-f0-9]{40}$");
    expect(source).not.toMatch(/secret|password/i);
  });
});
