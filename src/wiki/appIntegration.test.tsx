import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, vi } from "vitest";
import entitiesJson from "../../data/fixtures/release-4.3/entities.json";
import releaseJson from "../../data/fixtures/release-4.3/release.json";
import { App } from "../app/App";
import { GameReleaseBundleSchema, ReleaseIndexSchema } from "../domain/releases";

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

function releasedTestData() {
  const fixture = GameReleaseBundleSchema.parse({ release: releaseJson, entities: entitiesJson });
  const entities = structuredClone(fixture.entities);
  const character = entities.characters[0];
  const ability = character.abilities[0];
  const trace = {
    ...structuredClone(ability), logicalId: "trace:synthetic-support",
    revisionId: "trace:synthetic-support@4.3", name: "完整测试行迹", kind: "trace",
    originalText: "行迹完整原文。", effectIds: [],
  };
  const eidolon = {
    ...structuredClone(ability), logicalId: "eidolon:synthetic-support-1",
    revisionId: "eidolon:synthetic-support-1@4.3", name: "完整测试星魂", kind: "eidolon",
    originalText: "星魂完整原文。", effectIds: [],
  };
  character.traces = [trace];
  character.eidolons = [eidolon];
  const supported = entities.effects[0];
  supported.trigger = { type: "event", event: "施放终结技" };
  supported.duration = { type: "turns", value: 2 };
  supported.stacking = { type: "additive", maxStacks: 3 };
  supported.conditions = [{ type: "target-state", operator: "equals", value: "灼烧" }];
  supported.dispellable = true;
  const unsupported = {
    ...structuredClone(supported), id: "effect:synthetic-unsupported@4.3",
    reviewStatus: "unsupported" as const, originalText: "复杂效果仅保留原文。",
  };
  entities.effects.push(unsupported);
  ability.effectIds.push(unsupported.id);
  const relic = {
    ...structuredClone(entities.equipment[0]), kind: "relic-set" as const,
    logicalId: "relic-set:synthetic", revisionId: "relic-set:synthetic@4.3",
    name: "完整测试遗器", rarity: null, pathRestriction: null,
    superimpositionValues: [], setThresholds: [2, 4], effectIds: [],
  };
  entities.equipment.push(relic);
  const releaseId = "4.3-reviewed";
  const revisions = [
    ...entities.characters,
    ...entities.characters.flatMap((revision) => [...revision.abilities, ...revision.traces, ...revision.eidolons]),
    ...entities.equipment,
  ];
  for (const revision of revisions) {
    revision.validFromReleaseId = releaseId;
    revision.validToReleaseId = null;
  }
  const release = {
    ...fixture.release, id: releaseId, channel: "released" as const,
    sources: fixture.release.sources.map((source) => ({
      ...source, name: "Reviewed test source", url: "https://example.com/star-rail-reviewed",
    })),
  };
  const bundle = GameReleaseBundleSchema.parse({ release, entities });
  const index = ReleaseIndexSchema.parse({ currentReleaseId: releaseId, releases: [release] });
  return { bundle, index };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
}

test("loads a released bundle through the real hash-routed app and exposes complete details", async () => {
  const user = userEvent.setup();
  const { bundle, index } = releasedTestData();
  let releaseInitialIndex!: (response: Response) => void;
  const initialIndex = new Promise<Response>((resolve) => { releaseInitialIndex = resolve; });
  let indexRequests = 0;
  vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/index.json") && indexRequests++ === 0) return initialIndex;
    if (url.endsWith("/index.json")) return Promise.resolve(jsonResponse(index));
    if (url.endsWith("/release.json")) return Promise.resolve(jsonResponse(bundle.release));
    if (url.endsWith("/entities.json")) return Promise.resolve(jsonResponse(bundle.entities));
    return Promise.resolve(new Response(null, { status: 404 }));
  }));
  window.location.hash = "#/wiki/character/character%3Asynthetic-support";

  render(<App />);
  expect(screen.getByRole("status")).toHaveTextContent("正在加载版本资料");
  releaseInitialIndex(jsonResponse(index));

  expect(await screen.findByRole("heading", { name: "测试辅助" })).toBeVisible();
  expect(screen.getAllByText("正式服 4.3")).not.toHaveLength(0);
  expect(screen.queryByText("测试夹具 4.3")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "合成增益技能" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "完整测试行迹" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "完整测试星魂" })).toBeVisible();
  expect(screen.getByRole("list", { name: "可用效果" })).toHaveTextContent("触发：事件（施放终结技）");
  expect(screen.getByRole("list", { name: "不支持的效果" })).toHaveTextContent("复杂效果仅保留原文。");

  await user.click(screen.getByRole("link", { name: "← 返回资料库" }));
  await user.type(await screen.findByRole("searchbox", { name: "搜索资料" }), "完整测试遗器");
  await user.click(screen.getByRole("link", { name: "完整测试遗器" }));
  expect(await screen.findByRole("heading", { name: "完整测试遗器" })).toBeVisible();
  expect(screen.getByText(/套装档位/)).toHaveTextContent("2 / 4 件");
});

test("shows a direct-route alert when release loading fails", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
  window.location.hash = "#/wiki/character/character%3Asynthetic-support";

  render(<App />);

  expect(screen.getByRole("status")).toBeVisible();
  expect(await screen.findByRole("alert")).toHaveTextContent("network down");
});
