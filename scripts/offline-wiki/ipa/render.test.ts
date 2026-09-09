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

  it("renders escaped newlines and every supported game rich-text tag without exposing markup", () => {
    const body = String.raw`<align="center">采购订单</align>\n\n<align="right">编号 <unbreak>12-34</unbreak></align>\n<i>斜体</i><I>大写斜体</I><it>别名斜体</it><b>粗体</b><u>下划线</u><s>删除线</s><color=#dbc291ff>颜色</color><size=28>尺寸</size><rhythm><icon SpriteName=EmojiArrow id=0 width=1 height=1><未知标签>`;
    const archive: StoryArchive = { schemaVersion: 1, records: [record("collectible:1", "collectible", body)], rejections: [] };

    const content = renderArchiveVolumes(archive, { maxBodyCharacters: 1000 }).find((volume) => volume.family === "collectible")!;

    expect(content.html).toContain('<div class="game-align game-align-center">采购订单</div>');
    expect(content.html).toContain('<div class="game-align game-align-right">编号 <span class="game-nowrap">12-34</span></div>');
    expect(content.html).toContain("<em>斜体</em><em>大写斜体</em><em>别名斜体</em><strong>粗体</strong><u>下划线</u><s>删除线</s>颜色尺寸");
    expect(content.html).toContain('<span class="game-icon" aria-label="图标 EmojiArrow">〔图标：EmojiArrow〕</span>');
    expect(content.html).toContain("&lt;未知标签&gt;");
    expect(content.html).not.toContain(String.raw`\n`);
    expect(content.html).not.toContain("&lt;align");
    expect(content.html).not.toContain("&lt;unbreak");
  });

  it("preserves literal less-than signs that touch supported closing or opening tags", () => {
    const body = '<align="center">>>>标题<<<</align>\\n标准<<unbreak>10086</unbreak>>号\\n<s>录制<</s>';
    const archive: StoryArchive = { schemaVersion: 1, records: [record("collectible:2", "collectible", body)], rejections: [] };

    const content = renderArchiveVolumes(archive, { maxBodyCharacters: 1000 }).find((volume) => volume.family === "collectible")!;

    expect(content.html).toContain('<div class="game-align game-align-center">&gt;&gt;&gt;标题&lt;&lt;&lt;</div>');
    expect(content.html).toContain('标准&lt;<span class="game-nowrap">10086</span>&gt;号');
    expect(content.html).toContain("<s>录制&lt;</s>");
    expect(content.html).not.toContain("&lt;&lt;unbreak&gt;");
  });

  it("renders game tags in record names, section titles and metadata", () => {
    const value = record("character:2", "character", "正文");
    value.name = "银狼LV.<unbreak>999</unbreak>";
    value.sections[0]!.title = "<color=#dbc291ff>角色详情</color>";
    value.sections[0]!.speaker = "<i>旁白</i>";
    value.sections[0]!.branch = "<b>选项</b>";
    const archive: StoryArchive = { schemaVersion: 1, records: [value], rejections: [] };

    const content = renderArchiveVolumes(archive, { maxBodyCharacters: 1000 }).find((volume) => volume.family === "character")!;

    expect(content.html).toContain('<h2>银狼LV.<span class="game-nowrap">999</span></h2>');
    expect(content.html).toContain("<h3>角色详情</h3>");
    expect(content.html).toContain("说话人：<em>旁白</em>");
    expect(content.html).toContain("分支：<strong>选项</strong>");
    expect(content.html).not.toContain("&lt;unbreak&gt;");
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
