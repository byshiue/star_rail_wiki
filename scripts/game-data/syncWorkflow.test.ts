import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("released data sync workflow", () => {
  it("separates read-only build/audit from the credentialed draft-PR job", async () => {
    const workflow = await readFile(".github/workflows/sync-game-data.yml", "utf8");
    expect(workflow).toContain("discoverReleasedVersion.ts");
    expect(workflow).toContain("prepareReleaseCandidate.ts");
    expect(workflow).toContain("no-change");
    expect(workflow).toContain(".currentReleaseId");
    expect(workflow).toContain("npm run check");
    expect(workflow).toContain("actions/upload-artifact@v4");
    expect(workflow).toContain("actions/download-artifact@v4");
    expect(workflow).toContain("candidate-audit.json");
    expect(workflow).toContain("coverage.json");
    expect(workflow).toContain("entity-diff.json");
    expect(workflow).toContain("discover-build:");
    expect(workflow).toContain("open-review-pr:");
    expect(workflow).toContain("needs: discover-build");
    expect(workflow.match(/persist-credentials: false/g)).toHaveLength(2);
    expect(workflow.match(/contents: read/g)).toHaveLength(1);
    expect(workflow.match(/contents: write/g)).toHaveLength(1);
    expect(workflow.match(/pull-requests: write/g)).toHaveLength(1);
    expect(workflow.match(/github\.token/g)).toHaveLength(1);
    expect(workflow.match(/GH_TOKEN:/g)).toHaveLength(1);
    expect(workflow).toContain("git switch -c");
    expect(workflow).toContain("gh pr create --draft");
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
    expect(source).not.toContain("GITHUB_TOKEN");
    expect(source).not.toContain("Authorization");
    expect(source).not.toMatch(/secret|password/i);
  });
});
