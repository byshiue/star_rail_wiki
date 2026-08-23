import type { GameReleaseBundle } from "../domain/releases";
import type { TeamBuild, TeamEvaluation } from "../effects/evaluateTeam";
import { buildBuffBreakdown, formatBuffValue } from "./teamBuffBreakdown";

type TeamBuffBreakdownProps = {
  build: TeamBuild;
  evaluation: TeamEvaluation | null;
  bundle: GameReleaseBundle;
};

export function TeamBuffBreakdown({ build, evaluation, bundle }: TeamBuffBreakdownProps) {
  if (!build.members.length) return null;
  const breakdown = buildBuffBreakdown(build, evaluation, bundle);
  return (
    <section className="buff-breakdown" aria-labelledby="buff-breakdown-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">即时计算</p>
          <h2 id="buff-breakdown-title">当前 Buff 汇总</h2>
        </div>
        <span className="buff-count">{breakdown.rows.length} 项可计算</span>
      </div>
      {breakdown.rows.length ? (
        <ul className="buff-groups">
          {breakdown.rows.map((row) => (
            <li className="buff-group" key={row.id}>
              <div className="buff-group-heading">
                <strong>{row.scopeLabel} · {row.metricLabel}</strong>
                <span>叠加后总值 {formatBuffValue(row.operation, row.total)}</span>
              </div>
              <ul className="buff-contributions" aria-label={`${row.scopeLabel}${row.metricLabel}角色贡献`}>
                {row.contributions.map((contribution) => (
                  <li key={contribution.memberId}>
                    <span>{contribution.characterName} E{contribution.eidolon}</span>
                    <span>提供 {formatBuffValue(row.operation, contribution.value)}</span>
                  </li>
                ))}
              </ul>
              {row.conditional ? <small className="buff-note">包含当前场景下生效的条件增益</small> : null}
              {row.adjustmentLabel ? <small className="buff-note">{row.adjustmentLabel}</small> : null}
            </li>
          ))}
        </ul>
      ) : <p className="empty-result">当前选择没有已结构化且生效的增益。</p>}
      {breakdown.unsupported.length ? (
        <details className="unsupported-buffs">
          <summary>未计入总值的文字 Buff（{evaluation?.unsupported.length ?? 0}）</summary>
          <p>这些效果尚未完成结构化审核，因此只列出类别，不推测数值。</p>
          <ul>
            {breakdown.unsupported.map((character) => (
              <li key={character.memberId}>
                <strong>{character.characterName} E{character.eidolon}</strong>
                <span>{character.labels.join("、")}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
