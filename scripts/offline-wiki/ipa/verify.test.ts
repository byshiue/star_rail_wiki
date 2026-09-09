import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { StoryRecord } from "./story-schema";
import { buildIpaLore } from "./build";
import { verifyIpaLoreBuild } from "./verify";

const releaseId = "4.5-cn-2026-08-13";

function repository(): string {
  const root = mkdtempSync(join(tmpdir(), "hsr-ipa-verify-"));
  const importRoot = join(root, ".local", "offline-wiki", "ipa-imports", releaseId);
  mkdirSync(importRoot, { recursive: true });
  const record: StoryRecord = {
    schemaVersion: 1,
    logicalId: "character:1",
    family: "character",
    kind: "character-story",
    name: "角色甲",
    sections: [{ order: 0, title: null, speaker: null, branch: null, body: "完整正文", sourceHash: "1" }],
    provenance: { sourceTables: ["StoryAtlas"], sourceRowIds: ["1"] },
  };
  writeFileSync(join(importRoot, "archive.jsonl"), `${JSON.stringify(record)}\n`);
  writeFileSync(join(importRoot, "audit.json"), `${JSON.stringify({ schemaVersion: 1, releaseId, summaryFallbackCount: 0 })}\n`);
  return root;
}

describe("IPA offline build verification", () => {
  it("re-reads all files and verifies checksums, PDF pages and record totals", async () => {
    const root = repository();
    await buildIpaLore({
      repositoryRoot: root,
      releaseId,
      renderPdf: async () => ({ bytes: Buffer.from("%PDF-1.7\n/Type /Page\n%%EOF\n"), pageCount: 1 }),
    });
    expect(verifyIpaLoreBuild({ repositoryRoot: root, releaseId })).toEqual({
      releaseId,
      volumes: 2,
      pages: 2,
      records: 1,
    });
  });

  it("rejects a modified PDF after the manifest was written", async () => {
    const root = repository();
    await buildIpaLore({
      repositoryRoot: root,
      releaseId,
      renderPdf: async () => ({ bytes: Buffer.from("%PDF-1.7\n/Type /Page\n%%EOF\n"), pageCount: 1 }),
    });
    writeFileSync(join(root, ".local", "offline-wiki", "ipa-imports", releaseId, "build", "pdf", "00-总索引.pdf"), "%PDF-tampered");
    expect(() => verifyIpaLoreBuild({ repositoryRoot: root, releaseId })).toThrow(/checksum/i);
  });
});
