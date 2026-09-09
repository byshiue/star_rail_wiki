import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { StoryRecord } from "./story-schema";
import { buildIpaLore } from "./build";

const releaseId = "4.5-cn-2026-08-13";

function fixtureRecord(): StoryRecord {
  return {
    schemaVersion: 1,
    logicalId: "character:1",
    family: "character",
    kind: "character-story",
    name: "角色甲",
    sections: [{ order: 0, title: null, speaker: null, branch: null, body: "完整正文", sourceHash: "1" }],
    provenance: { sourceTables: ["StoryAtlas"], sourceRowIds: ["1"] },
  };
}

function repository(): string {
  const root = mkdtempSync(join(tmpdir(), "hsr-ipa-build-"));
  const importRoot = join(root, ".local", "offline-wiki", "ipa-imports", releaseId);
  mkdirSync(importRoot, { recursive: true });
  writeFileSync(join(importRoot, "archive.jsonl"), `${JSON.stringify(fixtureRecord())}\n`);
  writeFileSync(join(importRoot, "audit.json"), `${JSON.stringify({ schemaVersion: 1, releaseId, summaryFallbackCount: 0 })}\n`);
  return root;
}

describe("IPA offline PDF build", () => {
  it("writes matching HTML/PDF volumes and a checksum manifest under the local import", async () => {
    const root = repository();
    const manifest = await buildIpaLore({
      repositoryRoot: root,
      releaseId,
      renderPdf: async () => ({ bytes: Buffer.from("%PDF-1.4\nfixture\n%%EOF\n"), pageCount: 1 }),
    });

    expect(manifest.summaryFallbackCount).toBe(0);
    expect(manifest.outputs.map((value) => value.filename)).toEqual(["00-总索引.pdf", "01-角色故事-001.pdf"]);
    expect(manifest.outputs.every((value) => /^sha256:[a-f0-9]{64}$/u.test(value.checksum))).toBe(true);
    const buildRoot = join(root, ".local", "offline-wiki", "ipa-imports", releaseId, "build");
    expect(readFileSync(join(buildRoot, "html", "01-角色故事-001.html"), "utf8")).toContain("完整正文");
    expect(readFileSync(join(buildRoot, "pdf", "01-角色故事-001.pdf")).subarray(0, 5).toString()).toBe("%PDF-");
    expect(JSON.parse(readFileSync(join(buildRoot, "build-manifest.json"), "utf8"))).toEqual(manifest);
  });

  it("refuses to build when audit reports any summary fallback", async () => {
    const root = repository();
    const auditPath = join(root, ".local", "offline-wiki", "ipa-imports", releaseId, "audit.json");
    writeFileSync(auditPath, `${JSON.stringify({ schemaVersion: 1, releaseId, summaryFallbackCount: 1 })}\n`);
    await expect(buildIpaLore({
      repositoryRoot: root,
      releaseId,
      renderPdf: async () => ({ bytes: Buffer.from("%PDF-"), pageCount: 1 }),
    })).rejects.toThrow(/summary/i);
  });
});
