import { useEffect, useState } from "react";
import type { AccountProfile } from "../domain/profiles";
import { createPublicProfileExport } from "./publication";

const repositoryUrl = "https://github.com/byshiue/star_rail_wiki";

export function PublicProfileConsent({ profile, now = () => new Date().toISOString() }: { profile: AccountProfile; now?: () => string }) {
  const [consented, setConsented] = useState(false); const [json, setJson] = useState("");
  useEffect(() => { setConsented(false); setJson(""); }, [profile.uid, profile.updatedAt]);
  return <section className="public-profile-consent" aria-labelledby="publication-title"><h3 id="publication-title">发布公开档案</h3>
    <p><strong>公开风险：</strong>UID {profile.uid} 与下列库存将可被任何人读取。站点删除公开文件后，Git 历史与 GitHub Pages 历史版本中仍可能可见。</p>
    <details open><summary>将公开的完整字段预览</summary><ul><li>UID {profile.uid}</li><li>版本 {profile.dataReleaseId}</li><li>更新时间 {profile.updatedAt}</li><li>角色：{profile.characters.map((item) => item.logicalId).join("、") || "无"}</li><li>光锥：{profile.lightCones.map((item) => item.logicalId).join("、") || "无"}</li><li>遗器套装：{profile.relics.map((item) => item.setLogicalId).join("、") || "无"}</li></ul></details>
    <label><input type="checkbox" checked={consented} onChange={(event) => { setConsented(event.target.checked); if (!event.target.checked) setJson(""); }} />我明确同意公开此 UID 和库存，并理解 Git 历史可能长期保留</label>
    <button type="button" disabled={!consented} onClick={() => { if (consented) setJson(JSON.stringify(createPublicProfileExport(profile, now()), null, 2)); }}>生成公开 JSON</button>
    {json ? <div className="publication-artifact"><label>公开 JSON<textarea aria-label="公开 JSON" readOnly value={json} onFocus={(event) => event.currentTarget.select()} /></label><a href={`data:application/json;charset=utf-8,${encodeURIComponent(json)}`} download={`${profile.uid}.json`}>下载 {profile.uid}.json</a><ol><li>在 GitHub fork 仓库。</li><li>使用 <a href={`${repositoryUrl}/new/main/public/profiles?filename=${profile.uid}.json`} target="_blank" rel="noreferrer">GitHub 预填路径新建文件</a>，上传为 <code>public/profiles/{profile.uid}.json</code>。</li><li>同时更新 <code>public/profiles/index.json</code>，再通过 GitHub 的 Compare &amp; pull request 按钮人工提交 Pull Request 等待审查与合并。</li></ol><p>本站不会接收 GitHub token、不会自动上传，也不会自动 push。</p></div> : null}
  </section>;
}
