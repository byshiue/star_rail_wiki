import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useRelease } from "../app/ReleaseProvider";
import type { TeamPreset } from "../domain/community";
import { encodeTeamBuild } from "../simulator/teamBuild";
import { createTeamBuildFromPreset, loadCommunityTeamLibrary } from "./teamRepository";

type CommunityTeamsPageProps = { loadPresets?: () => Promise<TeamPreset[]> };

const investmentLabels = { low: "低投入", moderate: "中等投入", high: "高投入" } as const;

export function CommunityTeamsPage({ loadPresets = loadCommunityTeamLibrary }: CommunityTeamsPageProps) {
  const { bundle, loading: releaseLoading, error: releaseError } = useRelease();
  const navigate = useNavigate();
  const [presets, setPresets] = useState<TeamPreset[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [release, setRelease] = useState("all");
  const [archetype, setArchetype] = useState("all");
  const [character, setCharacter] = useState("");
  const [investment, setInvestment] = useState("all");

  useEffect(() => {
    if (!bundle) return;
    let active = true;
    setLoading(true);
    void loadPresets().then((loaded) => {
      if (active) {
        setPresets(loaded);
        setError(null);
        setLoading(false);
      }
    }).catch((caught: unknown) => {
      if (active) {
        setError(caught instanceof Error ? caught.message : "社区配队资料加载失败");
        setLoading(false);
      }
    });
    return () => { active = false; };
  }, [bundle, loadPresets]);

  const releases = useMemo(() => [...new Map(presets.map((preset) => [preset.releaseId, {
    releaseId: preset.releaseId, gameVersion: preset.gameVersion,
  }])).values()].sort((left, right) => left.releaseId.localeCompare(right.releaseId)), [presets]);
  const archetypes = useMemo(() => [...new Set(presets.flatMap((preset) => preset.tags))].sort(), [presets]);
  const filtered = useMemo(() => presets.filter((preset) => (
    (release === "all" || preset.releaseId === release)
    && (archetype === "all" || preset.tags.includes(archetype))
    && (investment === "all" || preset.investment === investment)
    && (!character.trim() || [...preset.slots, ...preset.substitutions.map((item) => item.characterLogicalId)]
      .some((logicalId) => logicalId.toLowerCase().includes(character.trim().toLowerCase())))
  )), [presets, release, archetype, character, investment]);

  function loadPreset(preset: TeamPreset) {
    if (!bundle) return;
    try {
      const build = createTeamBuildFromPreset(preset, bundle);
      navigate(`/simulator?build=${encodeTeamBuild(build)}`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "配队无法载入模拟器");
    }
  }

  if (releaseLoading) return <p role="status">正在加载版本资料…</p>;
  if (releaseError) return <div role="alert">版本资料加载失败：{releaseError}</div>;
  if (!bundle) return (
    <section className="empty-release" role="status">
      <h1>社区配队</h1>
      <p>暂无已发布版本；合成测试资料不会显示为正式当前推荐。</p>
    </section>
  );

  return (
    <section className="community-page" aria-labelledby="community-title">
      <header>
        <p className="eyebrow">来源可追溯 · 版本固定</p>
        <h1 id="community-title">社区配队</h1>
        <p>浏览项目整理的来源摘要；原作者、发布日期、抓取日期和历史可用性会完整保留。</p>
      </header>
      <div className="community-filters" aria-label="筛选社区配队">
        <label>适用版本<select aria-label="适用版本" value={release} onChange={(event) => setRelease(event.target.value)}>
          <option value="all">全部版本</option>
          {releases.map((value) => <option key={value.releaseId} value={value.releaseId}>{value.gameVersion}（{value.releaseId}）</option>)}
        </select></label>
        <label>配队流派<select aria-label="配队流派" value={archetype} onChange={(event) => setArchetype(event.target.value)}>
          <option value="all">全部流派</option>
          {archetypes.map((value) => <option key={value} value={value}>{value}</option>)}
        </select></label>
        <label>包含角色<input aria-label="包含角色" value={character} onChange={(event) => setCharacter(event.target.value)} placeholder="输入 logical ID" /></label>
        <label>投入假设<select aria-label="投入假设" value={investment} onChange={(event) => setInvestment(event.target.value)}>
          <option value="all">全部投入</option>
          <option value="low">低投入</option><option value="moderate">中等投入</option><option value="high">高投入</option>
        </select></label>
      </div>
      {error ? <div role="alert">{error}</div> : null}
      {loading ? <p role="status">正在加载社区配队…</p> : null}
      {!loading && filtered.length === 0 ? <p role="status">没有符合筛选条件的社区配队。</p> : null}
      <div className="community-team-grid">
        {filtered.map((preset) => {
          const stale = preset.releaseId !== bundle.release.id;
          return (
            <article className="community-team-card" key={preset.id}>
              <div className="community-team-heading">
                <div><p className="eyebrow">{preset.tags.join(" · ")}</p><h2>{preset.id}</h2></div>
                <span>{investmentLabels[preset.investment]}</span>
              </div>
              <p>{preset.summary}</p>
              <p><strong>角色：</strong>{preset.slots.join(" / ")}</p>
              <ul>{preset.substitutions.map((item) => <li key={`${item.slot}:${item.characterLogicalId}`}>替代 {item.slot + 1} 号位：{item.characterLogicalId}（{item.note}）</li>)}</ul>
              <p><strong>假设：</strong>{preset.requirements.join("；")}</p>
              {stale ? <p className="version-warning">适用于 {preset.gameVersion}；当前资料为 {bundle.release.gameVersion}，仅保留历史归属，不能直接载入。</p> : null}
              {preset.source.availability === "unavailable" ? <p className="source-warning">来源当前不可用；仍保留检索时记录。</p> : null}
              <p className="community-source">
                来源：<a href={preset.source.url} target="_blank" rel="noreferrer">{preset.source.title} — {preset.source.publisher}</a>
                <br />作者 {preset.source.author}；发布 {preset.source.publishedAt ?? "未标注"}；检索 {preset.source.retrievedAt}
              </p>
              <button type="button" disabled={stale} onClick={() => loadPreset(preset)}>载入配队实验室</button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
