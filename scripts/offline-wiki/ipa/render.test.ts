import { describe, expect, it } from "vitest";
import type { StoryArchive, StoryRecord } from "./story-schema";
import { renderArchiveVolumes } from "./render";

function record(logicalId: string, family: StoryRecord["family"], body: string): StoryRecord {
  return {
    schemaVersion: 1,
    logicalId,
    family,
    kind: "fixture",
    name: `名称 <${logicalId}>`,
    sections: [{ order: 0, title: "章节 & 一", speaker: "说话人", branch: null, body, sourceHash: "1" }],
    provenance: { sourceTables: ["Fixture"], sourceRowIds: ["1"] },
  };
}

describe("IPA story archive HTML renderer", () => {
  it("renders every complete section verbatim with HTML escaping and no summary fallback", () => {
    const archive: StoryArchive = {
      schemaVersion: 1,
      records: [record("character:1", "character", "第一行\n<script>危险</script>\n最后一行")],
      rejections: [],
    };
    const volumes = renderArchiveVolumes(archive, { maxBodyCharacters: 1000 });
    const content = volumes.find((volume) => volume.family === "character")!;

    expect(content.filename).toBe("01-角色故事-001.html");
    expect(content.html).toContain("第一行<br>\n&lt;script&gt;危险&lt;/script&gt;<br>\n最后一行");
    expect(content.html).not.toContain("<script>危险</script>");
    expect(content.html).toContain("章节 &amp; 一");
    expect(content.html).toContain("说话人");
  });

  it("splits only between records and emits deterministic continuous part numbers", () => {
    const archive: StoryArchive = {
      schemaVersion: 1,
      records: [
        record("mission-dialogue:1", "mission", "一".repeat(8)),
        record("mission-dialogue:2", "mission", "二".repeat(8)),
        record("mission-dialogue:3", "mission", "三".repeat(8)),
      ],
      rejections: [],
    };
    const volumes = renderArchiveVolumes(archive, { maxBodyCharacters: 10 }).filter((value) => value.family === "mission");
    expect(volumes.map((value) => value.filename)).toEqual([
      "06-任务剧情-001.html",
      "06-任务剧情-002.html",
      "06-任务剧情-003.html",
    ]);
    expect(volumes.map((value) => value.recordCount)).toEqual([1, 1, 1]);
  });

  it("includes a global index with counts and every generated volume", () => {
    const archive: StoryArchive = {
      schemaVersion: 1,
      records: [record("character:1", "character", "正文"), record("light-cone:1", "light-cone", "正文")],
      rejections: [],
    };
    const volumes = renderArchiveVolumes(archive, { maxBodyCharacters: 1000 });
    expect(volumes[0]?.filename).toBe("00-总索引.html");
    expect(volumes[0]?.html).toContain("角色故事：1 条");
    expect(volumes[0]?.html).toContain("01-角色故事-001.html");
    expect(volumes[0]?.html).toContain("02-光锥故事-001.html");
  });
});
