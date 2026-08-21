import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useRelease } from "../app/ReleaseProvider";
import { loadCommunityTeams } from "../community/teamRepository";
import type { TeamPreset } from "../domain/community";
import { encodeTeamBuild } from "../simulator/teamBuild";
import { recommendTeams, type RecommendationResult } from "./recommendTeams";
import { RecommendationConstraintError, type EncounterMode, type RecommendationObjective } from "./request";

type RecommendationPageProps = { loadPresets?: (releaseId: string) => Promise<TeamPreset[]> };

function ids(value: string): string[] {
  return [...new Set(value.split(/[\s,，\n]+/).map((item) => item.trim()).filter(Boolean))].sort();
}

const componentLabels = {
  roleCoverage: "职责覆盖", buffApplicability: "Buff 适用", mechanicSynergy: "机制协同",
  skillPointEconomy: "战技点经济", actionCompatibility: "行动兼容", weaknessCoverage: "弱点覆盖",
  survivability: "生存", activationCost: "启动成本", wastedEffects: "浪费效果", communityPrior: "社区先验",
} as const;

export function RecommendationPage({ loadPresets = loadCommunityTeams }: RecommendationPageProps) {
  const { bundle, loading, error: releaseError } = useRelease();
  const [presets, setPresets] = useState<TeamPreset[]>([]);
  const [presetError, setPresetError] = useState<string | null>(null);
  const [ownedOnly, setOwnedOnly] = useState(false);
  const defaultRoster = useMemo(() => bundle?.entities.characters
    .filter(({ validToReleaseId }) => validToReleaseId === null).map(({ logicalId }) => logicalId).sort().join(", ") ?? "", [bundle]);
  const [owned, setOwned] = useState("");
  const [uid, setUid] = useState("");
  const [required, setRequired] = useState("");
  const [excluded, setExcluded] = useState("");
  const [weaknesses, setWeaknesses] = useState("");
  const [archetype, setArchetype] = useState("");
  const [objective, setObjective] = useState<RecommendationObjective>("maximum-synergy");
  const [encounter, setEncounter] = useState<EncounterMode>("standard");
  const [results, setResults] = useState<RecommendationResult[]>([]);
  const [constraintError, setConstraintError] = useState<string | null>(null);

  useEffect(() => {
    if (!bundle) return;
    let active = true;
    setOwned(defaultRoster);
    void loadPresets(bundle.release.id).then((loaded) => {
      if (active) {
        setPresets([...loaded].sort((left, right) => left.id.localeCompare(right.id)));
        setPresetError(null);
      }
    }).catch((caught: unknown) => {
      if (active) setPresetError(caught instanceof Error ? caught.message : "社区参考加载失败");
    });
    return () => { active = false; };
  }, [bundle, defaultRoster, loadPresets]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!bundle) return;
    try {
      setResults(recommendTeams({
        releaseId: bundle.release.id,
        roster: ownedOnly ? { mode: "owned-only", characterIds: ids(owned) } : { mode: "unrestricted" },
        requiredCharacterIds: ids(required), excludedCharacterIds: ids(excluded),
        encounter: { mode: encounter, enemyWeaknesses: ids(weaknesses) }, objective,
        archetype: archetype.trim() || undefined, maxResults: 3, maxCombinations: 5_000,
      }, { bundle, communityPresets: presets }));
      setConstraintError(null);
    } catch (caught) {
      setResults([]);
      setConstraintError(caught instanceof RecommendationConstraintError
        ? caught.issues.map(({ message }) => message).join("；")
        : caught instanceof Error ? caught.message : "无法生成推荐");
    }
  }

  if (loading) return <p role="status">正在加载版本资料…</p>;
  if (releaseError) return <div role="alert">版本资料加载失败：{releaseError}</div>;
  if (!bundle) return <section className="empty-release" role="status"><h1>Agent 推荐</h1><p>暂无已发布版本；不会使用合成资料冒充正式推荐。</p></section>;

  return (
    <section className="recommendation-page" aria-labelledby="recommendation-title">
      <header><p className="eyebrow">本地规则 · 确定评分 · 无需 API 密钥</p><h1 id="recommendation-title">Agent 推荐</h1><p>固定到 {bundle.release.gameVersion}（{bundle.release.id}）；Buff 数值只来自配队实验室 evaluator。</p></header>
      <form className="recommendation-controls" onSubmit={submit}>
        <label>账号 UID（可选，仅作本次输入标识）<input aria-label="账号 UID" value={uid} onChange={(event) => setUid(event.target.value)} /></label>
        <label className="owned-toggle"><input type="checkbox" checked={ownedOnly} onChange={(event) => setOwnedOnly(event.target.checked)} />仅使用已拥有角色</label>
        <label className="wide-control">已拥有角色 logical ID<textarea aria-label="已拥有角色 logical ID" disabled={!ownedOnly} value={owned} onChange={(event) => setOwned(event.target.value)} /></label>
        <label>必选角色<input aria-label="必选角色" value={required} onChange={(event) => setRequired(event.target.value)} placeholder="逗号分隔 logical ID" /></label>
        <label>排除角色<input aria-label="排除角色" value={excluded} onChange={(event) => setExcluded(event.target.value)} placeholder="逗号分隔 logical ID" /></label>
        <label>推荐目标<select aria-label="推荐目标" value={objective} onChange={(event) => setObjective(event.target.value as RecommendationObjective)}><option value="maximum-synergy">最大协同</option><option value="comfort">舒适生存</option><option value="low-investment">低投入</option></select></label>
        <label>战斗场景<select aria-label="战斗场景" value={encounter} onChange={(event) => setEncounter(event.target.value as EncounterMode)}><option value="standard">常规</option><option value="break">击破</option><option value="follow-up">追击</option><option value="damage-over-time">持续伤害</option></select></label>
        <label>敌方弱点<input aria-label="敌方弱点" value={weaknesses} onChange={(event) => setWeaknesses(event.target.value)} /></label>
        <label>目标流派<input aria-label="目标流派" value={archetype} onChange={(event) => setArchetype(event.target.value)} /></label>
        <button type="submit">生成推荐</button>
      </form>
      {presetError ? <p className="source-warning">社区参考未载入：{presetError}。核心计算仍可离线运行，社区先验记为 0。</p> : null}
      {constraintError ? <div role="alert" className="build-error"><strong>约束冲突</strong><p>{constraintError}</p></div> : null}
      {!constraintError && results.length === 0 ? <p role="status">填写条件后生成最多三个可审计候选队伍。</p> : null}
      <div className="recommendation-results">
        {results.map((result, index) => (
          <article key={result.team.join("|")} aria-label={`候选队伍 ${index + 1}`} className="recommendation-card">
            <div className="recommendation-heading"><div><p className="eyebrow">候选 {index + 1}</p><h2>{result.team.join(" / ")}</h2></div><strong>{result.totalScore} 分</strong></div>
            <p>{result.explanation.summary}</p>
            <section><h3>评分分解 · {result.weightsVersion}</h3><dl className="score-components">{(Object.entries(result.components) as Array<[keyof typeof componentLabels, number]>).map(([key, value]) => <div key={key}><dt>{componentLabels[key]}</dt><dd>{Math.round(value * 100)}%（加权 {result.weighted[key]}）</dd></div>)}</dl></section>
            <section><h3>Buff 证据</h3><p>已应用 {result.evaluation.active.length + result.evaluation.conditional.length}；未满足 {result.evaluation.inactive.length}；浪费 {result.evaluation.wasted.length}。</p><ul>{result.explanation.evidenceIds.map((id) => <li key={id}><code>{id}</code></li>)}</ul>{result.explanation.unmetConditions.map((item) => <p key={`${item.evidenceId}:unmet`}>{item.effectId}：{item.reason}</p>)}</section>
            <section><h3>替代方案</h3>{result.substitutions.length ? <ul>{result.substitutions.map((item) => <li key={`${item.slot}:${item.replacement}`}>{item.slot + 1} 号位：{item.replacing} → {item.replacement}；总分变化 {item.scoreDelta >= 0 ? "+" : ""}{item.scoreDelta}</li>)}</ul> : <p>当前枚举范围没有单槽替代。</p>}</section>
            <section><h3>社区参考（封顶 5 分，不能推翻合法性）</h3>{result.communityReferences.length ? <ul>{result.communityReferences.map((reference) => <li key={reference.presetId}><a href={reference.sourceUrl} target="_blank" rel="noreferrer">{reference.presetId}</a> — {reference.author} / {reference.publisher}；贡献 {reference.boundedContribution * 5} 分；来源 {reference.availability}</li>)}</ul> : <p>无匹配的同版本来源；社区先验为 0。</p>}</section>
            <details><summary>枚举审计与排除理由</summary><p>评估 {result.audit.evaluatedCombinationCount} 个合法组合{result.audit.truncated ? "（已达组合上限）" : ""}。</p><ul>{result.audit.excluded.map((item, itemIndex) => <li key={`${item.reason}:${item.team.join("|")}:${itemIndex}`}>{item.team.join(" / ") || "其余组合"}：{item.reason}</li>)}</ul></details>
            <Link className="simulator-link" to={`/simulator?build=${encodeTeamBuild(result.build)}`}>载入模拟器</Link>
          </article>
        ))}
      </div>
    </section>
  );
}
