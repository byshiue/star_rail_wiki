import type { ChangeEvent } from "react";
import type { BattleScenario, FiredThisEvaluation } from "../effects/evaluateTeam";

type ScenarioControlsProps = {
  scenario: BattleScenario;
  onChange: (scenario: BattleScenario) => void;
  onFire: (fired: FiredThisEvaluation) => void;
};

function listValue(value: string): string[] {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function conditionValue(value: string): string | number | boolean {
  if (value === "true") return true;
  if (value === "false") return false;
  const number = Number(value);
  return value.trim() !== "" && Number.isFinite(number) ? number : value;
}

function parseConditions(value: string): Record<string, string | number | boolean> {
  return Object.fromEntries(value.split("\n").map((line) => line.split("=", 2).map((item) => item.trim()))
    .filter(([key, item]) => Boolean(key && item))
    .map(([key, item]) => [key, conditionValue(item)]));
}

function parseAssignments(value: string): Record<string, string> {
  return Object.fromEntries(value.split("\n").map((line) => line.split("=", 2).map((item) => item.trim()))
    .filter(([effectId, target]) => Boolean(effectId && target)) as Array<[string, string]>);
}

export function ScenarioControls({ scenario, onChange, onFire }: ScenarioControlsProps) {
  function checked(key: "enemyBroken" | "battleStarted" | "actionActive") {
    return (event: ChangeEvent<HTMLInputElement>) => onChange({ ...scenario, [key]: event.target.checked });
  }
  return (
    <details className="scenario-controls">
      <summary>场景条件</summary>
      <div className="scenario-grid">
        <label><input type="checkbox" checked={scenario.enemyBroken ?? false} onChange={checked("enemyBroken")} />敌人处于弱点击破</label>
        <label><input type="checkbox" checked={scenario.battleStarted ?? false} onChange={checked("battleStarted")} />战斗已开始（持续状态）</label>
        <button type="button" onClick={() => onFire({ battleStart: true })}>触发战斗开始一次</button>
        <label><input type="checkbox" checked={scenario.actionActive ?? false} onChange={checked("actionActive")} />行动阶段活跃（持续状态）</label>
        <button type="button" onClick={() => onFire({ action: true })}>触发行动一次</button>
        <label>
          <span>历史事件</span>
          <input
            aria-label="历史事件"
            value={(scenario.activeEvents ?? []).join(", ")}
            onChange={(event) => onChange({ ...scenario, activeEvents: listValue(event.target.value) })}
          />
        </label>
        <button
          type="button"
          disabled={!scenario.activeEvents?.length}
          onClick={() => onFire({ events: scenario.activeEvents })}
        >
          触发这些事件一次
        </button>
        <label>
          <span>敌方弱点（逗号分隔）</span>
          <input value={(scenario.enemyWeaknesses ?? []).join(", ")} onChange={(event) => onChange({ ...scenario, enemyWeaknesses: listValue(event.target.value) })} />
        </label>
        <label>
          <span>自定义条件（每行 key=value）</span>
          <textarea onChange={(event) => onChange({ ...scenario, conditions: parseConditions(event.target.value) })} />
        </label>
        <label>
          <span>目标指定（每行 effectId=slot/enemy）</span>
          <textarea aria-label="目标指定" onChange={(event) => onChange({ ...scenario, targetAssignments: parseAssignments(event.target.value) })} />
        </label>
      </div>
    </details>
  );
}
