import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Pages workflow security boundary", () => {
  it("grants deployment credentials only to the deploy job", async () => {
    const workflow = await readFile(".github/workflows/deploy-pages.yml", "utf8");
    const buildStart = workflow.indexOf("  build:\n");
    const deployStart = workflow.indexOf("  deploy:\n");
    const build = workflow.slice(buildStart, deployStart);
    const deploy = workflow.slice(deployStart);

    expect(workflow).toMatch(/\npermissions: \{\}\n/);
    expect(build).toMatch(/permissions:\n\s+contents: read/);
    expect(build).toContain("persist-credentials: false");
    expect(build).not.toMatch(/pages: write|id-token: write/);
    expect(build).toContain("run: npm run scan:secrets");
    expect(deploy).toMatch(/permissions:\n\s+pages: write\n\s+id-token: write/);
    expect(deploy).not.toMatch(/contents: write/);
  });
});
