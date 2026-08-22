import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { useRelease } from "../app/ReleaseProvider";
import { loadCommunityTeams } from "../community/teamRepository";
import type { TeamPreset } from "../domain/community";
import type { AccountProfile } from "../domain/profiles";
import { CharacterArchetypeSchema, type CharacterArchetype } from "../domain/entities";
import { allocateProfileMemberBuilds } from "../profiles/profileAllocation";
import { PROFILE_SELECTION_EVENT, readSelectedProfileUid, selectProfileUid } from "../profiles/profileSelection";
import { defaultProfileService, type ProfileService } from "../profiles/profileService";
import { encodeTeamBuild } from "../simulator/teamBuild";
import { recommendTeams, type RecommendationResult } from "./recommendTeams";
import { RecommendationConstraintError, type EncounterMode, type RecommendationContext, type RecommendationObjective } from "./request";

type RecommendationPageProps = {
  loadPresets?: (releaseId: string) => Promise<TeamPreset[]>;
  memberBuilds?: RecommendationContext["memberBuilds"];
  profileService?: ProfileService;
};

function ids(value: string): string[] {
  return [...new Set(value.split(/[\s,，\n]+/).map((item) => item.trim()).filter(Boolean))].sort();
}

const componentLabels = {
  roleCoverage: "职责覆盖", buffApplicability: "Buff 适用", mechanicSynergy: "机制协同",
  archetypeAffinity: "流派契合",
  skillPointEconomy: "战技点经济", actionCompatibility: "行动兼容", weaknessCoverage: "弱点覆盖",
  survivability: "生存", activationCost: "启动成本", wastedEffects: "浪费效果", communityPrior: "社区先验",
} as const;

export function RecommendationPage({ loadPresets = loadCommunityTeams, memberBuilds, profileService }: RecommendationPageProps) {
  const { bundle, loading, error: releaseError } = useRelease();
  const [presets, setPresets] = useState<TeamPreset[]>([]);
  const [presetError, setPresetError] = useState<string | null>(null);
  const [presetLoading, setPresetLoading] = useState(false);
  const [ownedOnly, setOwnedOnly] = useState(false);
  const defaultRoster = useMemo(() => bundle?.entities.characters
    .filter(({ validToReleaseId }) => validToReleaseId === null).map(({ logicalId }) => logicalId).sort().join(", ") ?? "", [bundle]);
  const [owned, setOwned] = useState("");
  const [profiles, setProfiles] = useState<AccountProfile[]>([]);
  const [selectedUid, setSelectedUid] = useState("");
  const [selectedProfile, setSelectedProfile] = useState<AccountProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const profileRequest = useRef(0);
  const [switchNotice, setSwitchNotice] = useState(false);
  const [required, setRequired] = useState("");
  const [excluded, setExcluded] = useState("");
  const [weaknesses, setWeaknesses] = useState("");
  const [archetype, setArchetype] = useState<CharacterArchetype | "">("");
  const [objective, setObjective] = useState<RecommendationObjective>("maximum-synergy");
  const [encounter, setEncounter] = useState<EncounterMode>("standard");
  const [results, setResults] = useState<RecommendationResult[]>([]);
  const [constraintError, setConstraintError] = useState<string | null>(null);

  useEffect(() => {
    setPresets([]); setResults([]); setPresetError(null);
    if (!bundle) { setPresetLoading(false); return; }
    let active = true;
    setPresetLoading(true);
    void loadPresets(bundle.release.id).then((loaded) => {
      if (active) {
        setPresets([...loaded].sort((left, right) => left.id.localeCompare(right.id)));
        setPresetError(null);
        setPresetLoading(false);
      }
    }).catch((caught: unknown) => {
      if (active) { setPresets([]); setPresetError(caught instanceof Error ? caught.message : "社区参考加载失败"); setPresetLoading(false); }
    });
    return () => { active = false; };
  }, [bundle, defaultRoster, loadPresets]);

  useEffect(() => { if (!selectedProfile) setOwned(defaultRoster); }, [defaultRoster, selectedProfile]);

  const activeProfileService = profileService ?? (typeof indexedDB === "undefined" ? null : defaultProfileService);

  useEffect(() => {
    if (!activeProfileService) { setProfiles([]); setProfileLoading(false); return; }
    let active = true;
    async function loadProfiles(requestedUid: string | null) {
      const requestId = ++profileRequest.current;
      setProfileLoading(true); setSelectedUid(""); setSelectedProfile(null);
      setOwned(defaultRoster); setOwnedOnly(false);
      try {
        const loaded = await activeProfileService!.listProfiles();
        if (!active || requestId !== profileRequest.current) return;
        setProfiles(loaded);
        const profile = loaded.find(({ uid }) => uid === requestedUid) ?? null;
        setSelectedUid(profile?.uid ?? "");
        setSelectedProfile(profile);
        if (profile) { setOwned(profile.characters.map(({ logicalId }) => logicalId).sort().join(", ")); setOwnedOnly(true); }
        else { setOwned(defaultRoster); setOwnedOnly(false); }
        setProfileError(null);
      } catch (caught) {
        if (active && requestId === profileRequest.current) setProfileError(caught instanceof Error ? caught.message : "本地账号读取失败");
      } finally { if (active && requestId === profileRequest.current) setProfileLoading(false); }
    }
    void loadProfiles(readSelectedProfileUid());
    const selectionListener = (event: Event) => {
      const uid = event instanceof CustomEvent && typeof event.detail === "string" ? event.detail : null;
      setResults([]); setConstraintError(null); setSwitchNotice(true);
      void loadProfiles(uid);
    };
    window.addEventListener(PROFILE_SELECTION_EVENT, selectionListener);
    return () => { active = false; window.removeEventListener(PROFILE_SELECTION_EVENT, selectionListener); };
  }, [activeProfileService, defaultRoster]);

  const profileAllocation = useMemo(() => selectedProfile && bundle
    ? allocateProfileMemberBuilds(selectedProfile, bundle, memberBuilds) : null, [bundle, memberBuilds, selectedProfile]);
  const effectiveMemberBuilds = profileAllocation?.memberBuilds ?? memberBuilds;

  function chooseProfile(nextUid: string) {
    selectProfileUid(nextUid || null);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!bundle || presetLoading || profileLoading) return;
    if (selectedProfile && selectedProfile.dataReleaseId !== bundle.release.id) {
      setResults([]); setConstraintError("档案版本 " + selectedProfile.dataReleaseId + " 与推荐版本 " + bundle.release.id + " 不一致"); return;
    }
    try {
      setResults(recommendTeams({
        releaseId: bundle.release.id,
        roster: ownedOnly ? { mode: "owned-only", characterIds: ids(owned) } : { mode: "unrestricted" },
        requiredCharacterIds: ids(required), excludedCharacterIds: ids(excluded),
        encounter: { mode: encounter, enemyWeaknesses: ids(weaknesses) }, objective,
        archetype: archetype || undefined,
        investment: selectedProfile ? {
          allowedLightConeIds: selectedProfile.lightCones.map(({ logicalId }) => logicalId).sort(),
          allowedRelicSetIds: [...new Set(selectedProfile.relics.map(({ setLogicalId }) => setLogicalId))].sort(),
        } : undefined,
        maxResults: 3, maxCombinations: 5_000,
      }, { bundle, communityPresets: presets, memberBuilds: effectiveMemberBuilds }));
      setConstraintError(null); setSwitchNotice(false);
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
      {selectedProfile ? <div className="profile-allocation-note"><p>档案资源按 stable ID 确定分配；配置值只会与真实库存、叠影上限、命途和剩余实例取交集。</p>{profileAllocation?.exclusions.length ? <details><summary>未采用或受限配置（{profileAllocation.exclusions.length}）</summary><ul>{profileAllocation.exclusions.map((item, index) => <li key={item.characterId + ":" + item.code + ":" + (item.logicalId ?? "") + ":" + index}>{item.message}</li>)}</ul></details> : null}</div> : null}
      <form className="recommendation-controls" onSubmit={submit}>
        <label>本地账号 UID<select aria-label="本地账号 UID" value={selectedUid} disabled={profileLoading} onChange={(event) => chooseProfile(event.target.value)}><option value="">不使用本地档案</option>{profiles.map((profile) => <option key={profile.uid} value={profile.uid}>{profile.label ?? "未命名账号"} · {profile.uid}</option>)}</select></label>
        <label className="owned-toggle"><input type="checkbox" checked={ownedOnly} disabled={selectedProfile !== null} onChange={(event) => setOwnedOnly(event.target.checked)} />仅使用已拥有角色</label>
        <label className="wide-control">已拥有角色 logical ID<textarea aria-label="已拥有角色 logical ID" disabled={!ownedOnly} readOnly={selectedProfile !== null} value={owned} onChange={(event) => setOwned(event.target.value)} /></label>
        <label>必选角色<input aria-label="必选角色" value={required} onChange={(event) => setRequired(event.target.value)} placeholder="逗号分隔 logical ID" /></label>
        <label>排除角色<input aria-label="排除角色" value={excluded} onChange={(event) => setExcluded(event.target.value)} placeholder="逗号分隔 logical ID" /></label>
        <label>推荐目标<select aria-label="推荐目标" value={objective} onChange={(event) => setObjective(event.target.value as RecommendationObjective)}><option value="maximum-synergy">最大协同</option><option value="comfort">舒适生存</option><option value="low-investment">低投入</option></select></label>
        <label>战斗场景<select aria-label="战斗场景" value={encounter} onChange={(event) => setEncounter(event.target.value as EncounterMode)}><option value="standard">常规</option><option value="break">击破</option><option value="follow-up">追击</option><option value="damage-over-time">持续伤害</option></select></label>
        <label>敌方弱点<input aria-label="敌方弱点" value={weaknesses} onChange={(event) => setWeaknesses(event.target.value)} /></label>
        <label>目标流派<select aria-label="目标流派" value={archetype} onChange={(event) => setArchetype(event.target.value as CharacterArchetype | "")}><option value="">不指定</option>{CharacterArchetypeSchema.options.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <button type="submit" disabled={presetLoading || profileLoading || (selectedProfile !== null && selectedProfile.dataReleaseId !== bundle.release.id)}>{presetLoading ? "正在加载社区参考…" : profileLoading ? "正在加载本地账号…" : "生成推荐"}</button>
      </form>
      {profileError ? <p className="source-warning">本地账号未载入：{profileError}。仍可使用手动输入。</p> : null}
      {selectedProfile && selectedProfile.dataReleaseId !== bundle.release.id ? <p className="version-warning">所选 UID 固定到 {selectedProfile.dataReleaseId}，当前推荐版本为 {bundle.release.id}；请切换匹配版本或账号。</p> : null}
      {presetError ? <p className="source-warning">社区参考未载入：{presetError}。核心计算仍可离线运行，社区先验记为 0。</p> : null}
      {constraintError ? <div role="alert" className="build-error"><strong>约束冲突</strong><p>{constraintError}</p></div> : null}
      {!constraintError && results.length === 0 ? <p role="status">{switchNotice ? "切换账号后已清除旧推荐；请重新生成。" : "填写条件后生成最多三个可审计候选队伍。"}</p> : null}
      <div className="recommendation-results">
        {results.map((result, index) => (
          <article key={result.team.join("|")} aria-label={`候选队伍 ${index + 1}`} className="recommendation-card">
            <div className="recommendation-heading"><div><p className="eyebrow">候选 {index + 1}</p><h2>{result.team.join(" / ")}</h2></div><strong>{result.totalScore} 分</strong></div>
            <p>{result.explanation.summary}</p>
            <p><strong>目标／场景：</strong>{result.requestSummary.objective} ／ {result.requestSummary.encounter.mode}{result.requestSummary.archetype ? ` ／ ${result.requestSummary.archetype}` : ""}</p>
            <p><strong>角色职责：</strong>{result.team.map((id) => `${id}（${result.roles[id].join("+")}）`).join("；")}</p>
            <section><h3>优势与弱点</h3><p><strong>优势：</strong>{result.explanation.strengths.join("；") || "无达到阈值的突出组件"}</p><p><strong>弱点：</strong>{result.explanation.weaknesses.join("；") || "没有已识别的主要弱点"}</p></section>
            <section><h3>评分分解 · {result.weightsVersion}</h3><dl className="score-components">{(Object.entries(result.components) as Array<[keyof typeof componentLabels, number]>).map(([key, value]) => <div key={key}><dt>{componentLabels[key]}</dt><dd>{Math.round(value * 100)}%（权重 {result.appliedWeights[key]}；加权 {result.weighted[key]}）</dd></div>)}</dl></section>
            <section><h3>Buff 证据</h3><p>已应用 {result.evaluation.active.length + result.evaluation.conditional.length}；未满足 {result.evaluation.inactive.length}；浪费 {result.evaluation.wasted.length}。</p><ul>{[...result.evaluation.active, ...result.evaluation.conditional].map((entry) => <li key={entry.evaluationId}><strong>{entry.metric}</strong> {entry.operation} {entry.value}；证据 <code>{entry.evidence.id}</code>；来源修订 <code>{entry.sourceRevisionId}</code></li>)}</ul>{result.explanation.unmetConditions.map((item) => <p key={`${item.evidenceId}:unmet`}>{item.effectId}：{item.reason}</p>)}</section>
            <section><h3>替代方案</h3>{result.substitutions.length ? <ul>{result.substitutions.map((item) => <li key={`${item.slot}:${item.replacement}`}>{item.slot + 1} 号位：{item.replacing} → {item.replacement}；总分变化 {item.scoreDelta >= 0 ? "+" : ""}{item.scoreDelta}；组件变化 {Object.entries(item.componentDeltas).map(([key, value]) => `${componentLabels[key as keyof typeof componentLabels]} ${Number(value) >= 0 ? "+" : ""}${value}`).join("、") || "无"}</li>)}</ul> : <p>当前枚举范围没有单槽替代。</p>}</section>
            <section><h3>社区参考（封顶 5 分，不能推翻合法性）</h3>{result.communityReferences.length ? <ul>{result.communityReferences.map((reference) => <li key={reference.presetId}>{reference.availability === "available" ? <a href={reference.sourceUrl} target="_blank" rel="noreferrer">{reference.presetId}</a> : <span>{reference.presetId}</span>} — {reference.author} / {reference.publisher}；贡献 {reference.boundedContribution * result.appliedWeights.communityPrior} 分；来源 {reference.availability}；发布 {reference.publication}；检索 {reference.retrievedAt}{reference.eligibilityIssues.length ? `；不合格：${reference.eligibilityIssues.join("、")}` : ""}</li>)}</ul> : <p>无匹配的同版本来源；社区先验为 0。</p>}</section>
            <details><summary>枚举审计与排除理由</summary><p>评估 {result.audit.evaluatedCombinationCount} 个合法组合{result.audit.truncated ? "（已达组合上限）" : ""}。</p><ul>{result.audit.excluded.map((item, itemIndex) => <li key={`${item.reason}:${item.team.join("|")}:${itemIndex}`}>{item.team.join(" / ") || "其余组合"}：{item.reason}{item.detail ? `：${item.detail}` : ""}</li>)}</ul></details>
            <Link className="simulator-link" to={`/simulator?build=${encodeTeamBuild(result.build)}`}>载入模拟器</Link>
          </article>
        ))}
      </div>
    </section>
  );
}
