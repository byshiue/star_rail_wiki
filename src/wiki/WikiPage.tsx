import { Link } from "react-router-dom";
import { useRelease } from "../app/ReleaseProvider";
import { useWikiSearch } from "./useWikiSearch";
import { VersionBadge } from "./VersionBadge";
import type { WikiEntityKind } from "./searchIndex";

const kindLabels: Record<WikiEntityKind, string> = { character: "角色", "light-cone": "光锥", "relic-set": "遗器套装" };

function WikiBrowser() {
  const { bundle } = useRelease();
  if (!bundle) return null;
  const { query, setQuery, filters, setFilters, results, error } = useWikiSearch(bundle);
  if (error) return <section><h1>资料索引失败</h1><p role="alert">{error}</p></section>;
  const selectedKind = filters.kinds?.[0] ?? "";
  return <section className="wiki-page" aria-labelledby="wiki-title">
    <div className="wiki-heading"><div><p className="eyebrow">可追溯资料库</p><h1 id="wiki-title">角色与装备</h1></div><VersionBadge release={bundle.release} /></div>
    {bundle.release.channel === "fixture" && <p className="fixture-notice">当前浏览的是显式测试夹具，不是正式版本。</p>}
    {bundle.release.id === "4.4-cn-2026-08-21" && <div className="version-warning" role="status"><strong>资料浏览完整，模拟覆盖有限。</strong><p>2,780 项含数值说明产生 4,667 条候选：42 条可计算，4,625 条明确不支持；可计算效果中只有 1 条是全队目标，另有 1 条单体队友与 1 条全体敌人效果。静默数值说明与未映射候选均为 0。目前只有布洛妮娅「作战再部署」与佩拉「领域压制」支持 1–15 级精确数值；未选择时按 1 级计算并在证据标记为默认。</p></div>}
    <div className="wiki-controls">
      <label>搜索资料<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      <label>资料类型<select value={selectedKind} onChange={(event) => setFilters({ ...filters, kinds: event.target.value ? [event.target.value as WikiEntityKind] : undefined })}>
        <option value="">全部</option><option value="character">角色</option><option value="light-cone">光锥</option><option value="relic-set">遗器</option>
      </select></label>
    </div>
    <p className="result-count" aria-live="polite">找到 {results.length} 条资料</p>
    <ul className="wiki-results">{results.map((result) => <li key={`${result.kind}:${result.id}`}>
      <Link to={`/wiki/${result.kind}/${encodeURIComponent(result.id)}`}>{result.name}</Link>
      <span>{kindLabels[result.kind]} · {result.rarity ? `${result.rarity} 星` : "无稀有度"} · {result.reviewStatus}</span><p>{result.description}</p>
    </li>)}</ul>
    {results.length === 0 && <p>没有符合条件的资料。</p>}
  </section>;
}

export function WikiPage() {
  const { bundle, loading, error } = useRelease();
  if (loading) return <p role="status">正在加载版本资料…</p>;
  if (error) return <section><h1>资料加载失败</h1><p role="alert">{error}</p></section>;
  if (!bundle) return <section className="empty-release"><p className="eyebrow">版本状态</p><h1>尚未导入正式版本</h1><p>正式资料库会在已审核的 released 版本写入索引后开放。</p></section>;
  return <WikiBrowser />;
}
