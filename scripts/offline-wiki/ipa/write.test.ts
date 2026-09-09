import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { StoryArchive } from "./story-schema";
import { writeArchiveTransaction } from "./write";

const archive: StoryArchive = {
  schemaVersion: 1,
  records: [{
    schemaVersion: 1,
    logicalId: "character:1",
    family: "character",
    kind: "character-story",
    name: "角色甲",
    sections: [{ order: 0, title: "故事一", speaker: null, branch: null, body: "完整官方正文", sourceHash: "1" }],
    provenance: { sourceTables: ["StoryAtlas"], sourceRowIds: ["1"] },
  }],
  rejections: [],
};

const audit = {
  schemaVersion: 1 as const,
  releaseId: "4.5-cn-2026-08-13",
  summaryFallbackCount: 0 as const,
  recordsByFamily: { character: 1 },
  rejectionCount: 0,
  textMapConflicts: [{ hash: "9", ipaChecksum: "sha256:a", supplementChecksum: "sha256:b", ipaBytes: 1, supplementBytes: 2 }],
};

describe("local IPA story archive transaction", () => {
  it("writes full text locally but keeps audit metadata body-free", () => {
    const repositoryRoot = mkdtempSync(join(tmpdir(), "hsr-ipa-write-"));
    const result = writeArchiveTransaction({ repositoryRoot, releaseId: audit.releaseId, archive, audit });

    expect(result.root).toBe(join(repositoryRoot, ".local", "offline-wiki", "ipa-imports", audit.releaseId));
    expect(readFileSync(result.archivePath, "utf8")).toContain("完整官方正文");
    const auditText = readFileSync(result.auditPath, "utf8");
    expect(auditText).not.toContain("完整官方正文");
    expect(JSON.parse(auditText).textMapConflicts[0].hash).toBe("9");
  });

  it("rejects release identifiers that could escape the local output root", () => {
    const repositoryRoot = mkdtempSync(join(tmpdir(), "hsr-ipa-write-"));
    expect(() => writeArchiveTransaction({ repositoryRoot, releaseId: "../escape", archive, audit: { ...audit, releaseId: "../escape" } })).toThrow(/release/i);
  });

  it("does not replace a last-good archive when staging validation fails", () => {
    const repositoryRoot = mkdtempSync(join(tmpdir(), "hsr-ipa-write-"));
    const previousRoot = join(repositoryRoot, ".local", "offline-wiki", "ipa-imports", audit.releaseId);
    mkdirSync(previousRoot, { recursive: true });
    writeFileSync(join(previousRoot, "archive.jsonl"), "last-good\n");
    writeFileSync(join(previousRoot, "audit.json"), "{}\n");

    expect(() => writeArchiveTransaction({
      repositoryRoot,
      releaseId: audit.releaseId,
      archive,
      audit,
      operations: { beforePromote: () => { throw new Error("injected failure"); } },
    })).toThrow(/injected failure/);
    expect(readFileSync(join(previousRoot, "archive.jsonl"), "utf8")).toBe("last-good\n");
  });
});
