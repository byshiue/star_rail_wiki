import { describe, expect, it } from "vitest";
import { renderReviewPage } from "./page";

describe("offline wiki review page", () => {
  it("shows every source link beside the editable Agent summary", () => {
    const html = renderReviewPage([{
      filename: "character-1.draft.json",
      draft: {
        logicalId: "character:1",
        entityKind: "character",
        releaseId: "4.4-fixture",
        locale: "zh-CN",
        summary: "原创故事摘要。",
        reviewStatus: "draft",
        provenance: [{
          sourceName: "Official public wiki",
          sourceUrl: "https://wiki.hoyolab.com/pc/hsr/entry/1",
          sourceRevision: "2026-09-06",
          sourcePath: "entry/1",
          sourceChecksum: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        }],
      },
    }]);

    expect(html).toContain("https://wiki.hoyolab.com/pc/hsr/entry/1");
    expect(html).toContain("Official public wiki");
    expect(html).toContain("2026-09-06");
  });
});
