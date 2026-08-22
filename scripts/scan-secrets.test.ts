import { describe, expect, it } from "vitest";
import { findSecretFindings, SECRET_SCAN_EXCLUDED_PREFIXES } from "./scan-secrets";

describe("repository secret scanner", () => {
  it("detects provider credentials and high-entropy assignments", () => {
    const github = "gh" + "p_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";
    const aws = "AK" + "IA" + "A1B2C3D4E5F6G7H8";
    const assigned = "api_key=\"A1b2C3d4E5f6G7h8I9j0K1l2\"";
    expect(findSecretFindings("src/leak.ts", [github, aws, assigned].join("\n")).map(({ rule }) => rule)).toEqual([
      "github-token", "aws-access-key", "high-entropy-assignment",
    ]);
  });

  it("detects common unquoted env and additional provider token forms", () => {
    const env = "API_" + "KEY=" + "A1b2C3d4E5f6G7h8I9j0K1l2";
    const npm = "np" + "m_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";
    const slack = "xo" + "xb-" + "123456789012-123456789012-A1b2C3d4E5f6G7h8";
    const gitlab = "gl" + "pat-" + "A1b2C3d4E5f6G7h8I9j0";
    expect(findSecretFindings(".env", [env, npm, slack, gitlab].join("\n")).map(({ rule }) => rule)).toEqual([
      "npm-token", "slack-token", "gitlab-token", "high-entropy-assignment",
    ]);
  });

  it("allows immutable revisions and GitHub Actions ephemeral contexts", () => {
    const safe = [
      "revision = \"b95e75c7e1273d819d20c530c0b7e13a3ef19fb4\"",
      "token: \"${{ github.token }}\"",
    ].join("\n");
    expect(findSecretFindings(".github/workflows/check.yml", safe)).toEqual([]);
  });

  it("documents and honors the dedicated fake-fixture exclusion", () => {
    expect(SECRET_SCAN_EXCLUDED_PREFIXES).toEqual(["scripts/secret-scan-fixtures/"]);
    const fake = "gh" + "p_" + "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8";
    expect(findSecretFindings("scripts/secret-scan-fixtures/provider.txt", fake)).toEqual([]);
  });
});
