import { printStyles } from "./styles";

export function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function textToHtml(value: string): string {
  return escapeHtml(value).replaceAll("\n", "<br>");
}

export function anchorFor(logicalId: string): string {
  return `entry-${logicalId.replaceAll(/[^A-Za-z0-9_-]/g, "-")}`;
}

export function htmlDocument(title: string, releaseLabel: string, body: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>${printStyles}</style>
</head>
<body>
  <header class="cover" id="top"><h1>${escapeHtml(title)}</h1><p>资料版本：${escapeHtml(releaseLabel)}</p><p>非官方离线资料；故事内容可能包含经审核原创摘要、自动生成且未经人工复核的原创摘要，以及仅存在于本机的用户导入全文。</p></header>
  ${body}
</body>
</html>\n`;
}
