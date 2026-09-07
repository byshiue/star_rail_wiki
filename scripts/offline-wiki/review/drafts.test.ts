import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { promoteDraft } from "./drafts";
import { startReviewServer } from "./server";

const draft = {
  logicalId: "character:1",
  entityKind: "character" as const,
  releaseId: "4.4-fixture",
  locale: "zh-CN" as const,
  summary: "原创故事摘要。",
  reviewStatus: "draft" as const,
  provenance: [{
    sourceName: "Official public wiki",
    sourceUrl: "https://wiki.hoyolab.com/pc/hsr/entry/1",
    sourceRevision: "2026-09-06",
    sourcePath: "entry/1",
    sourceChecksum: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  }],
};

describe("offline wiki draft review", () => {
  it("refuses to promote a draft without an explicit accept decision", () => {
    expect(() => promoteDraft(draft, {
      decision: "reject",
      reviewer: "Fixture reviewer",
      reviewedAt: "2026-09-06T01:00:00.000Z",
    })).toThrow(/accept/i);
  });

  it("promotes accepted text into a checksummed reviewed summary", () => {
    expect(promoteDraft(draft, {
      decision: "accept",
      reviewer: "Fixture reviewer",
      reviewedAt: "2026-09-06T01:00:00.000Z",
      editedSummary: "原创故事摘要。",
    })).toEqual({
      logicalId: "character:1",
      entityKind: "character",
      releaseId: "4.4-fixture",
      locale: "zh-CN",
      summary: "原创故事摘要。",
      contentChecksum: "sha256:ef3ad281972dbcdd4a2f01fd692a9eb7b606a65ed903772133d9dafa3e3c2bd9",
      reviewStatus: "reviewed",
      reviewer: { name: "Fixture reviewer", reviewedAt: "2026-09-06T01:00:00.000Z" },
      provenance: draft.provenance,
    });
  });

  it("binds the review server to loopback and rejects non-loopback hosts", async () => {
    const draftsRoot = mkdtempSync(join(tmpdir(), "offline-wiki-review-"));
    mkdirSync(draftsRoot, { recursive: true });
    const server = await startReviewServer({ host: "127.0.0.1", port: 0, draftsRoot });
    try {
      expect((server.address() as AddressInfo).address).toBe("127.0.0.1");
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }

    await expect(startReviewServer({ host: "0.0.0.0", port: 0, draftsRoot }))
      .rejects.toThrow(/loopback/i);
  });

  it("writes an accepted browser review into the committed-summary shape", async () => {
    const draftsRoot = mkdtempSync(join(tmpdir(), "offline-wiki-review-"));
    const editorialRoot = mkdtempSync(join(tmpdir(), "offline-wiki-reviewed-"));
    mkdirSync(join(editorialRoot, "summaries"), { recursive: true });
    writeFileSync(join(editorialRoot, "summaries", "characters.json"), "[]");
    writeFileSync(join(draftsRoot, "character-1.draft.json"), JSON.stringify(draft));
    const server = await startReviewServer({ host: "127.0.0.1", port: 0, draftsRoot, editorialRoot });
    try {
      const address = server.address() as AddressInfo;
      const body = new URLSearchParams({
        filename: "character-1.draft.json",
        decision: "accept",
        reviewer: "Fixture reviewer",
        summary: "原创故事摘要。",
      });
      const response = await fetch(`http://127.0.0.1:${address.port}/api/promote`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body,
        redirect: "manual",
      });

      expect(response.status).toBe(303);
      const reviewed = JSON.parse(readFileSync(join(editorialRoot, "summaries", "characters.json"), "utf8"));
      expect(reviewed).toMatchObject([{
        logicalId: "character:1",
        reviewStatus: "reviewed",
        reviewer: { name: "Fixture reviewer" },
      }]);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
