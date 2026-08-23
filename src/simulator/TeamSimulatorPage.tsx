import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useRelease } from "../app/ReleaseProvider";
import type { GameReleaseBundle } from "../domain/releases";
import type { BattleScenario, EffectEvidence, FiredThisEvaluation, TeamBuild } from "../effects/evaluateTeam";
import { EffectSummary } from "./EffectSummary";
import { EvidenceDrawer } from "./EvidenceDrawer";
import { ScenarioControls } from "./ScenarioControls";
import { decodeTeamBuild, encodeTeamBuild, validateTeamBuild } from "./teamBuild";
import { TeamBuffBreakdown } from "./TeamBuffBreakdown";
import { TeamSlots } from "./TeamSlots";
import { useTeamBuild } from "./useTeamBuild";

type WorkspaceProps = {
  bundle: GameReleaseBundle;
  title: string;
  description: string;
  maxSlots: number;
};

function readSharedBuild(
  value: string | null, bundle: GameReleaseBundle, maxMembers: number, label: string,
): { build?: TeamBuild; error?: string } {
  if (!value) return {};
  try {
    const build = decodeTeamBuild(value);
    if (build.releaseId !== bundle.release.id) return {
      error: `构筑链接固定到版本 ${build.releaseId}，当前仅载入 ${bundle.release.id}。请清除链接后重新构筑。`,
    };
    return { build: validateTeamBuild(build, bundle, { maxMembers, label }) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "构筑链接无法读取。" };
  }
}

function SimulatorWorkspace({ bundle, title, description, maxSlots }: WorkspaceProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const sharedValue = searchParams.get("build");
  const shared = useMemo(
    () => readSharedBuild(sharedValue, bundle, maxSlots, maxSlots === 1 ? "角色构筑" : "队伍"),
    [sharedValue, bundle, maxSlots],
  );
  const [linkError, setLinkError] = useState<string | null>(shared.error ?? null);
  const [scenario, setScenario] = useState<BattleScenario>({ battleStarted: true });
  const [evidence, setEvidence] = useState<EffectEvidence | null>(null);
  const applyingLocation = useRef(false);
  const team = useTeamBuild(bundle, scenario, shared.build, maxSlots);
  const encoded = useMemo((): { value: string | null; error: string | null } => {
    if (!team.build.members.length) return { value: null, error: null };
    try {
      return { value: encodeTeamBuild(team.build), error: null };
    } catch (error) {
      return {
        value: null,
        error: error instanceof Error ? error.message : "构筑输入无法编码。",
      };
    }
  }, [team.build]);

  useLayoutEffect(() => {
    applyingLocation.current = true;
    if (shared.error) {
      team.clear();
      setLinkError(shared.error);
      return;
    }
    setLinkError(null);
    team.replaceBuild(shared.build ?? { releaseId: bundle.release.id, members: [] });
  }, [shared, bundle.release.id]);

  useEffect(() => {
    if (applyingLocation.current) {
      applyingLocation.current = false;
      return;
    }
    if (linkError || encoded.error) return;
    if (encoded.value === sharedValue) return;
    setSearchParams(encoded.value ? { build: encoded.value } : {}, { replace: true });
  }, [encoded, linkError, setSearchParams, sharedValue]);

  function clearSharedBuild() {
    applyingLocation.current = true;
    team.clear();
    setLinkError(null);
    setSearchParams({}, { replace: true });
  }

  function updateScenario(next: BattleScenario) {
    const { firedThisEvaluation: _ignored, ...persistent } = next;
    setScenario(persistent);
  }

  function fireScenario(firedThisEvaluation: FiredThisEvaluation) {
    team.evaluateOnce(firedThisEvaluation);
  }

  const error = linkError ?? team.validationError?.message ?? encoded.error;
  return (
    <section className="simulator-page" aria-labelledby="simulator-title">
      <header className="simulator-hero">
        <p className="eyebrow">版本固定 · 可解释评估</p>
        <h1 id="simulator-title">{title}</h1>
        <p>{description}</p>
      </header>
      {error ? (
        <div className="build-error" role="alert">
          <strong>无法载入当前构筑</strong>
          <p>{error}</p>
          {linkError ? <button type="button" onClick={clearSharedBuild}>清除链接并重新构筑</button> : null}
        </div>
      ) : null}
      {team.build.communityPreset ? (
        <section className="community-assumptions" role="region" aria-label="社区预设假设">
          <h2>社区预设假设</h2>
          <p><strong>预设：</strong>{team.build.communityPreset.presetId}</p>
          <p><strong>投入：</strong>{team.build.communityPreset.investment}</p>
          <p><strong>要求：</strong>{team.build.communityPreset.requirements.join("；")}</p>
          <ul>
            {team.build.communityPreset.substitutions.map((substitution) => (
              <li key={`${substitution.slot}:${substitution.characterLogicalId}`}>
                替代 {substitution.slot + 1} 号位：{substitution.characterLogicalId}（{substitution.note}）
              </li>
            ))}
            {team.build.communityPreset.memberAssumptions.map((assumption, index) => (
              <li key={`assumption:${index}`}>第 {index + 1} 位：{assumption.eidolon} 魂；{assumption.equipment.status === "specified"
                ? `${assumption.equipment.logicalId}（叠影 ${assumption.equipment.superimposition}）`
                : assumption.equipment.reason}</li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="simulator-layout">
        <div className="builder-column">
          <TeamSlots bundle={bundle} build={team.build} maxSlots={maxSlots} onChange={team.updateMember} />
          <TeamBuffBreakdown build={team.build} evaluation={team.evaluation} bundle={bundle} />
          <ScenarioControls scenario={scenario} onChange={updateScenario} onFire={fireScenario} />
          {encoded.value ? (
            <label className="share-field">
              <span>分享链接（固定到 {bundle.release.id}）</span>
              <input readOnly value={`#${maxSlots === 1 ? "/builds" : "/simulator"}?build=${encoded.value}`} onFocus={(event) => event.currentTarget.select()} />
            </label>
          ) : null}
        </div>
        <EffectSummary evaluation={team.evaluation} bundle={bundle} onEvidence={setEvidence} />
      </div>
      <EvidenceDrawer evidence={evidence} bundle={bundle} onClose={() => setEvidence(null)} />
    </section>
  );
}

export type TeamSimulatorPageProps = {
  title?: string;
  description?: string;
  maxSlots?: number;
};

export function TeamSimulatorPage({
  title = "配队实验室",
  description = "配置最多四名角色的星魂、光锥、叠影与遗器，并在固定版本下评估增益、减益、条件与资源效果。",
  maxSlots = 4,
}: TeamSimulatorPageProps) {
  const { bundle, loading, error } = useRelease();
  if (loading) return <p role="status">正在加载版本资料…</p>;
  if (error) return <div role="alert">版本资料加载失败：{error}</div>;
  if (!bundle) return <section className="empty-release" role="status"><h1>{title}</h1><p>暂无已发布版本，无法进行构筑评估。</p></section>;
  return <SimulatorWorkspace bundle={bundle} title={title} description={description} maxSlots={maxSlots} />;
}
