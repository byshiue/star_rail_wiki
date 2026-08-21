import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useRelease } from "../app/ReleaseProvider";
import type { GameReleaseBundle } from "../domain/releases";
import type { BattleScenario, EffectEvidence, TeamBuild } from "../effects/evaluateTeam";
import { EffectSummary } from "./EffectSummary";
import { EvidenceDrawer } from "./EvidenceDrawer";
import { ScenarioControls } from "./ScenarioControls";
import { decodeTeamBuild, encodeTeamBuild, validateTeamBuild } from "./teamBuild";
import { TeamSlots } from "./TeamSlots";
import { useTeamBuild } from "./useTeamBuild";

type WorkspaceProps = {
  bundle: GameReleaseBundle;
  title: string;
  description: string;
  maxSlots: number;
};

function readSharedBuild(value: string | null, bundle: GameReleaseBundle): { build?: TeamBuild; error?: string } {
  if (!value) return {};
  try {
    const build = decodeTeamBuild(value);
    if (build.releaseId !== bundle.release.id) return {
      error: `构筑链接固定到版本 ${build.releaseId}，当前仅载入 ${bundle.release.id}。请清除链接后重新构筑。`,
    };
    return { build: validateTeamBuild(build, bundle) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "构筑链接无法读取。" };
  }
}

function SimulatorWorkspace({ bundle, title, description, maxSlots }: WorkspaceProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const sharedValue = searchParams.get("build");
  const shared = useMemo(() => readSharedBuild(sharedValue, bundle), [sharedValue, bundle]);
  const [linkError, setLinkError] = useState<string | null>(shared.error ?? null);
  const [scenario, setScenario] = useState<BattleScenario>({});
  const [evidence, setEvidence] = useState<EffectEvidence | null>(null);
  const team = useTeamBuild(bundle, scenario, shared.build);

  useEffect(() => {
    if (team.build.members.length === 0 || linkError) return;
    setSearchParams({ build: encodeTeamBuild(team.build) }, { replace: true });
  }, [team.build, linkError, setSearchParams]);

  function clearSharedBuild() {
    team.clear();
    setLinkError(null);
    setSearchParams({}, { replace: true });
  }

  const error = linkError ?? team.validationError?.message ?? null;
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
      <div className="simulator-layout">
        <div className="builder-column">
          <TeamSlots bundle={bundle} build={team.build} maxSlots={maxSlots} onChange={team.updateMember} />
          <ScenarioControls scenario={scenario} onChange={setScenario} />
          {team.build.members.length ? (
            <label className="share-field">
              <span>分享链接（固定到 {bundle.release.id}）</span>
              <input readOnly value={`#${maxSlots === 1 ? "/builds" : "/simulator"}?build=${encodeTeamBuild(team.build)}`} onFocus={(event) => event.currentTarget.select()} />
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
