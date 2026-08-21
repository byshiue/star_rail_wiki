import type { ChangeEvent } from "react";
import type { BattleScenario } from "../effects/evaluateTeam";

type ScenarioControlsProps = {
  scenario: BattleScenario;
  onChange: (scenario: BattleScenario) => void;
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

export function ScenarioControls({ scenario, onChange }: ScenarioControlsProps) {
  function checked(key: "enemyBroken" | "battleStarted" | "actionActive") {
    return (event: ChangeEvent<HTMLInputElement>) => onChange({ ...scenario, [key]: event.target.checked });
  }
  return (
    <details className="scenario-controls">
      <summary>场景条件</summary>
      <div className="scenario-grid">
        <label><input type="checkbox" checked={scenario.enemyBroken ?? false} onChange={checked("enemyBroken")} />敌人处于弱点击破</label>
        <label><input type="checkbox" checked={scenario.battleStarted ?? false} onChange={checked("battleStarted")} />战斗已开始</label>
        <label><input type="checkbox" checked={scenario.actionActive ?? false} onChange={checked("actionActive")} />行动触发中</label>
        <label>
          <span>触发事件（逗号分隔）</span>
          <input
            value={(scenario.activeEvents ?? []).join(", ")}
            onChange={(event) => {
              const activeEvents = listValue(event.target.value);
              onChange({ ...scenario, activeEvents, firedThisEvaluation: { ...scenario.firedThisEvaluation, events: activeEvents } });
            }}
          />
        </label>
        <label>
          <span>敌方弱点（逗号分隔）</span>
          <input value={(scenario.enemyWeaknesses ?? []).join(", ")} onChange={(event) => onChange({ ...scenario, enemyWeaknesses: listValue(event.target.value) })} />
        </label>
        <label>
          <span>自定义条件（每行 key=value）</span>
          <textarea onChange={(event) => onChange({ ...scenario, conditions: parseConditions(event.target.value) })} />
        </label>
      </div>
    </details>
  );
}
