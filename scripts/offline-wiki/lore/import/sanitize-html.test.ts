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

  it("extracts nested allowlisted blocks once in stable DOM order", () => {
    expect(sanitizeSavedHtml("<ul><li>before<p>nested</p>after</li></ul><table><tr><td><p>cell</p></td></tr></table>")).toEqual([
      { label: "list-item", text: "before" },
      { label: "paragraph", text: "nested" },
      { label: "list-item", text: "after" },
      { label: "paragraph", text: "cell" },
    ]);
  });

  it("removes controls before filtering reconstructed protocols and event tokens", () => {
    const result = sanitizeSavedHtml("<p>保留 java&#0;script:run https&#0;://bad.invalid on&#0;click=run 结尾</p>");
    expect(result).toEqual([{ label: "paragraph", text: "保留 结尾" }]);
    expect(JSON.stringify(result)).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]|https?:\/\/|javascript:|\bon[a-z]+\s*=/iu);
  });
});
