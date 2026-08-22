import { render, screen } from "@testing-library/react";
import entitiesJson from "../../data/fixtures/release-4.3/entities.json";
import releaseJson from "../../data/fixtures/release-4.3/release.json";
import { GameReleaseBundleSchema } from "../domain/releases";
import { EffectSourceList } from "./EffectSourceList";

test("separates unsupported original text and discloses structured effect semantics", () => {
  const bundle = GameReleaseBundleSchema.parse({ release: releaseJson, entities: entitiesJson });
  const revision = bundle.entities.characters[0].abilities[0];
  const supported = {
    ...bundle.entities.effects[0],
    trigger: { type: "event" as const, event: "施放终结技" },
    duration: { type: "turns" as const, value: 2 },
    stacking: { type: "additive" as const, maxStacks: 3 },
    conditions: [{ type: "target-state", operator: "equals" as const, value: "灼烧" }],
    dispellable: true,
  };
  const unsupported = {
    ...supported,
    id: "effect:unsupported-test",
    reviewStatus: "unsupported" as const,
    originalText: "复杂机制仅保留原文。",
    conditions: [{ type: "不支持：触发与叠层机制尚未完成逐机制建模" }],
  };

  render(<EffectSourceList revision={revision} effects={[supported, unsupported]} release={bundle.release} />);

  expect(screen.getByRole("list", { name: "可用效果" })).toHaveTextContent("触发：事件（施放终结技）");
  expect(screen.getByRole("list", { name: "可用效果" })).toHaveTextContent("持续：2 回合");
  expect(screen.getByRole("list", { name: "可用效果" })).toHaveTextContent("叠加：可叠加，最多 3 层");
  expect(screen.getByRole("list", { name: "可用效果" })).toHaveTextContent("条件：target-state equals 灼烧");
  expect(screen.getByRole("list", { name: "可用效果" })).toHaveTextContent("可驱散：是");
  expect(screen.getByRole("list", { name: "不支持的效果" })).toHaveTextContent("复杂机制仅保留原文。");
  expect(screen.getByRole("list", { name: "不支持的效果" })).toHaveTextContent("原因：触发与叠层机制尚未完成逐机制建模");
  expect(screen.getByRole("list", { name: "可用效果" })).not.toHaveTextContent("复杂机制仅保留原文。");
});
