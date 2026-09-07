import type { DraftSummary } from "./drafts";
import { escapeHtml } from "../render/html";

export function renderReviewPage(drafts: Array<{ filename: string; draft: DraftSummary }>): string {
  const content = drafts.length === 0
    ? "<p>目前没有待审核摘要。</p>"
    : drafts.map(({ filename, draft }) => `<article>
      <h2>${escapeHtml(draft.logicalId)}</h2>
      <p>版本：${escapeHtml(draft.releaseId)}</p>
      <h3>来源</h3>
      <ul>${draft.provenance.map((source) => `<li><a href="${escapeHtml(source.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.sourceName)}</a> · revision ${escapeHtml(source.sourceRevision)}</li>`).join("")}</ul>
      <form method="post" action="/api/promote">
        <input type="hidden" name="filename" value="${escapeHtml(filename)}">
        <label>审核者 <input required name="reviewer"></label>
        <label>摘要 <textarea required name="summary" rows="8">${escapeHtml(draft.summary)}</textarea></label>
        <button name="decision" value="accept">接受并写入正式资料</button>
        <button name="decision" value="reject">退回</button>
      </form>
    </article>`).join("");
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>离线 Wiki 摘要审核</title>
  <style>body{font:16px sans-serif;max-width:900px;margin:2rem auto;padding:0 1rem}article{border-top:1px solid #ccc;padding:1rem 0}label{display:block;margin:.6rem 0}textarea{display:block;width:100%}</style>
  </head><body><h1>离线 Wiki 摘要审核</h1>${content}</body></html>`;
}
