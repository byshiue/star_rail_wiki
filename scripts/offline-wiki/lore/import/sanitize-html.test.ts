import { describe, expect, it } from "vitest";
import { sanitizeSavedHtml } from "./sanitize-html";

describe("sanitizeSavedHtml", () => {
  it("keeps only ordered allowlisted text blocks and safe labels", () => {
    const result = sanitizeSavedHtml(`
      <!-- hidden note -->
      <h2 onclick="steal()">测试标题</h2>
      <p>第一段 <strong>保留文字</strong></p>
      <ul><li>列表项目</li></ul>
      <table><tr><th>栏位</th><td>内容</td></tr></table>
      <script><p>脚本正文</p></script>
      <style>.x { background: url(https://bad.invalid/a) }</style>
      <iframe src="https://bad.invalid/frame"><p>框架正文</p></iframe>
      <form><p>表单正文</p></form>
      <a href="javascript:steal()">危险链接</a>
      <img src="https://bad.invalid/image.png" onerror="steal()">
    `);

    expect(result).toEqual([
      { label: "heading", text: "测试标题" },
      { label: "paragraph", text: "第一段 保留文字" },
      { label: "list-item", text: "列表项目" },
      { label: "table-heading", text: "栏位" },
      { label: "table-cell", text: "内容" },
    ]);
    expect(JSON.stringify(result)).not.toMatch(/<|>|https?:\/\/|javascript:|onerror|onclick|hidden note/i);
  });

  it("removes URL and markup-like text from otherwise allowed blocks", () => {
    const result = sanitizeSavedHtml("<p>安全 https://bad.invalid/x javascript:run &lt;tag&gt; 结尾</p>");
    expect(result).toEqual([{ label: "paragraph", text: "安全 tag 结尾" }]);
    expect(JSON.stringify(result)).not.toMatch(/<|>|https?:\/\/|javascript:/i);
  });

  it("does not include text nested inside blocked descendants", () => {
    const result = sanitizeSavedHtml("<p>可见<script>嵌套脚本正文</script><style>.hidden{color:red}</style>结尾</p>");
    expect(result).toEqual([{ label: "paragraph", text: "可见结尾" }]);
  });
});
