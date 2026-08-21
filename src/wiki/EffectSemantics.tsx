import type { Effect } from "../domain/effects";

function formatTrigger(trigger: Effect["trigger"]): string {
  if (trigger.type === "event") return `事件（${trigger.event}）`;
  return { always: "始终", "battle-start": "战斗开始", action: "行动时" }[trigger.type];
}

function formatDuration(duration: Effect["duration"]): string {
  if (duration.type === "turns") return `${duration.value} 回合`;
  if (duration.type === "actions") return `${duration.value} 次行动`;
  return { permanent: "永久", instant: "即时" }[duration.type];
}

function formatStacking(stacking: Effect["stacking"]): string {
  if (stacking.type === "additive") return `可叠加，最多 ${stacking.maxStacks} 层`;
  return { none: "不可叠加", refresh: "重复触发刷新", replace: "新效果替换旧效果" }[stacking.type];
}

function formatCondition(condition: Effect["conditions"][number]): string {
  return [condition.type, condition.operator, condition.value].filter((field) => field !== undefined).join(" ");
}

export function EffectSemantics({ effect }: { effect: Effect }) {
  return <dl className="effect-semantics">
    <div><dt>触发：</dt><dd>{formatTrigger(effect.trigger)}</dd></div>
    <div><dt>持续：</dt><dd>{formatDuration(effect.duration)}</dd></div>
    <div><dt>叠加：</dt><dd>{formatStacking(effect.stacking)}</dd></div>
    <div><dt>条件：</dt><dd>{effect.conditions.length ? effect.conditions.map(formatCondition).join("；") : "无"}</dd></div>
    <div><dt>可驱散：</dt><dd>{effect.dispellable === null ? "未标注" : effect.dispellable ? "是" : "否"}</dd></div>
  </dl>;
}
