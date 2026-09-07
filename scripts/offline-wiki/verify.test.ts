import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildOfflineWiki } from "./build";
import { verifyOfflineWiki } from "./verify";

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "__fixtures__", "releases");

describe("offline wiki PDF verification", () => {
  it("verifies every declared PDF checksum and detects output corruption", async () => {
    const outputRoot = mkdtempSync(join(tmpdir(), "offline-wiki-verify-"));
    await buildOfflineWiki({
      releasesRoot: fixtureRoot,
      editorialRoot: join(repositoryRoot, "data", "offline-wiki"),
      releaseId: "4.4-fixture",
      outputRoot,
      renderPdf: async () => ({
        bytes: new TextEncoder().encode("%PDF-1.7\n/Type /Page\n%%EOF\n"),
        pageCount: 1,
      }),
    });

    expect(verifyOfflineWiki({ outputRoot, releaseId: "4.4-fixture" })).toEqual({
      releaseId: "4.4-fixture",
      verifiedFiles: 5,
      pages: 5,
    });

    writeFileSync(
      join(outputRoot, "builds", "4.4-fixture", "pdf", "00-总索引.pdf"),
      "%PDF-1.7\ncorrupted\n%%EOF\n",
    );
    expect(() => verifyOfflineWiki({ outputRoot, releaseId: "4.4-fixture" })).toThrow(/checksum/i);
  });
});
