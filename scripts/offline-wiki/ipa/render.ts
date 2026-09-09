import { printStyles } from "../render/styles";
import type { StoryArchive, StoryFamily, StoryRecord } from "./story-schema";

export type RenderArchiveOptions = { maxBodyCharacters?: number };

export type ArchiveHtmlVolume = {
  filename: string;
  family: StoryFamily | null;
  title: string;
  recordCount: number;
  html: string;
};

const families: readonly { family: StoryFamily; prefix: string; label: string }[] = [
  { family: "character", prefix: "01", label: "角色故事" },
  { family: "light-cone", prefix: "02", label: "光锥故事" },
  { family: "relic-set", prefix: "03", label: "遗器故事" },
  { family: "divergent-universe", prefix: "04", label: "差分宇宙" },
  { family: "worldview", prefix: "05", label: "世界观" },
  { family: "mission", prefix: "06", label: "任务剧情" },
  { family: "collectible", prefix: "07", label: "文本收藏" },
];

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function bodyHtml(value: string): string {
  return escapeHtml(value).replaceAll("\r\n", "\n").replaceAll("\r", "\n").replaceAll("\n", "<br>\n");
}

function document(title: string, content: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${printStyles}</style>
</head>
<body>
${content}
</body>
</html>
`;
}

function renderRecord(value: StoryRecord): string {
  const sections = value.sections.map((section) => {
    const metadata = [
      section.title ? `<h3>${escapeHtml(section.title)}</h3>` : "",
      section.speaker ? `<div class="meta">说话人：${escapeHtml(section.speaker)}</div>` : "",
      section.branch ? `<div class="meta">分支：${escapeHtml(section.branch)}</div>` : "",
    ].filter(Boolean).join("\n");
    return `<section class="lore-section" data-source-hash="${escapeHtml(section.sourceHash)}">
${metadata}
<div>${bodyHtml(section.body)}</div>
</section>`;
  }).join("\n");
  return `<article class="entry" id="${escapeHtml(value.logicalId)}">
<h2>${escapeHtml(value.name)}</h2>
<div class="meta">${escapeHtml(value.kind)} · ${escapeHtml(value.logicalId)}</div>
${sections}
</article>`;
}

function chunks(records: StoryRecord[], maximum: number): StoryRecord[][] {
  const result: StoryRecord[][] = [];
  let current: StoryRecord[] = [];
  let characters = 0;
  for (const value of records) {
    const size = value.sections.reduce((sum, section) => sum + section.body.length, 0);
    if (current.length > 0 && characters + size > maximum) {
      result.push(current);
      current = [];
      characters = 0;
    }
    current.push(value);
    characters += size;
  }
  if (current.length > 0) result.push(current);
  return result;
}

function renderContentVolumes(archive: StoryArchive, maximum: number): ArchiveHtmlVolume[] {
  const volumes: ArchiveHtmlVolume[] = [];
  for (const definition of families) {
    const records = archive.records.filter((record) => record.family === definition.family);
    for (const [index, part] of chunks(records, maximum).entries()) {
      const partNumber = String(index + 1).padStart(3, "0");
      const title = `${definition.label} ${partNumber}`;
      const content = `<header class="cover"><h1>${escapeHtml(title)}</h1><p>${part.length} 条完整记录</p></header>\n${part.map(renderRecord).join("\n")}`;
      volumes.push({
        filename: `${definition.prefix}-${definition.label}-${partNumber}.html`,
        family: definition.family,
        title,
        recordCount: part.length,
        html: document(title, content),
      });
    }
  }
  return volumes;
}

function renderIndex(archive: StoryArchive, volumes: ArchiveHtmlVolume[]): ArchiveHtmlVolume {
  const counts = new Map<StoryFamily, number>();
  for (const record of archive.records) counts.set(record.family, (counts.get(record.family) ?? 0) + 1);
  const familyRows = families.map((definition) => `<li>${definition.label}：${counts.get(definition.family) ?? 0} 条</li>`).join("\n");
  const volumeRows = volumes.map((volume) => `<li>${escapeHtml(volume.filename)}（${volume.recordCount} 条）</li>`).join("\n");
  const title = "崩坏：星穹铁道 4.5 离线全文总索引";
  return {
    filename: "00-总索引.html",
    family: null,
    title,
    recordCount: archive.records.length,
    html: document(title, `<header class="cover"><h1>${title}</h1><p>完整原文归档，不含摘要替代。</p></header>
<h2>分类统计</h2><ul>${familyRows}</ul>
<h2>分册</h2><ol>${volumeRows}</ol>`),
  };
}

export function renderArchiveVolumes(archive: StoryArchive, options: RenderArchiveOptions = {}): ArchiveHtmlVolume[] {
  const maximum = options.maxBodyCharacters ?? 250_000;
  if (!Number.isSafeInteger(maximum) || maximum < 1) throw new Error("maxBodyCharacters must be a positive safe integer");
  const volumes = renderContentVolumes(archive, maximum);
  return [renderIndex(archive, volumes), ...volumes];
}
