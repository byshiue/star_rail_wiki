import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HashRouter, Route, Routes } from "react-router-dom";
import { afterEach, vi } from "vitest";
import type { CharacterRevision, EquipmentRevision } from "../domain/entities";
import type { Effect } from "../domain/effects";
import type { GameReleaseBundle } from "../domain/releases";
import { fixtureBundle } from "../effects/__fixtures__/goldenTeams";
import { ReleaseProvider } from "../app/ReleaseProvider";
import { CharacterBuilderPage } from "./CharacterBuilderPage";
import { TeamSimulatorPage } from "./TeamSimulatorPage";
import { encodeTeamBuild } from "./teamBuild";

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

function reviewBundle(): GameReleaseBundle {
  const bundle = structuredClone(fixtureBundle);
  bundle.release.id = "release-4.3";
  bundle.release.channel = "released";
  bundle.release.sources = bundle.release.sources.map((source) => ({
    ...source, name: "正式服资料源", url: "https://example.com/star-rail/4.3",
  }));
  const support = bundle.entities.characters[0]!;
  support.logicalId = "character:support";
  support.name = "测试辅助";
  support.path = "harmony";
  support.abilities[0]!.logicalId = "ability:support";
  support.abilities[0]!.revisionId = "ability:support@4.3";
  support.abilities[0]!.effectIds = [];
  const dps: CharacterRevision = {
    ...structuredClone(support), logicalId: "character:dps", revisionId: "character:dps@4.3",
    name: "测试输出", path: "destruction", abilities: [], traces: [], eidolons: [],
  };
  const relic = (index: number): EquipmentRevision => ({
    ...structuredClone(bundle.entities.equipment[0]!), kind: "relic-set",
    logicalId: `relic-set:test-${index}`, revisionId: `relic-set:test-${index}@4.3`,
    name: `测试遗器${index}`, rarity: null, pathRestriction: null, superimpositionValues: [],
    setThresholds: [2, 4], effectIds: [],
  });
  bundle.entities.characters = [support, dps];
  bundle.entities.equipment = [
    {
      ...bundle.entities.equipment[0]!, logicalId: "light-cone:harmony",
      revisionId: "light-cone:harmony@4.3", name: "同谐光锥", pathRestriction: "harmony",
    },
    relic(1), relic(2), relic(3),
  ];
  bundle.entities.effects = [];
  return bundle;
}

function effect(bundle: GameReleaseBundle, changes: Partial<Effect>): Effect {
  const template = structuredClone(fixtureBundle.entities.effects[0]!);
  return {
    ...template, id: changes.id ?? "effect:test", sourceRevisionId: bundle.entities.characters[0]!.abilities[0]!.revisionId,
    value: { base: 0.1, scaling: [] }, target: { type: "team" }, conditions: [], trigger: { type: "always" },
    duration: { type: "permanent" }, stacking: { type: "none", maxStacks: 1 }, ...changes,
  };
}

function renderHashPage(bundle: GameReleaseBundle, page: "simulator" | "builds" = "simulator") {
  return render(
    <HashRouter>
      <Routes>
        <Route path="/simulator" element={<ReleaseProvider bundle={bundle}><TeamSimulatorPage /></ReleaseProvider>} />
        <Route path="/builds" element={<ReleaseProvider bundle={bundle}><CharacterBuilderPage /></ReleaseProvider>} />
      </Routes>
    </HashRouter>,
  );
}

test("renders applied aggregation groups with operations, concrete targets, totals, caps, and warnings", async () => {
  const user = userEvent.setup();
  const bundle = reviewBundle();
  bundle.entities.effects = [
    effect(bundle, { id: "effect:add-a", metric: "damage_bonus", operation: "percent", value: { base: 0.2, scaling: [] } }),
    effect(bundle, { id: "effect:add-b", metric: "damage_bonus", operation: "percent", value: { base: 0.3, scaling: [] } }),
    effect(bundle, { id: "effect:mul-a", metric: "damage_bonus", operation: "multiplier", value: { base: 0.2, scaling: [] } }),
    effect(bundle, { id: "effect:mul-b", metric: "damage_bonus", operation: "multiplier", value: { base: 0.5, scaling: [] } }),
    effect(bundle, { id: "effect:override-a", metric: "damage_bonus", operation: "override", value: { base: 0.3, scaling: [] } }),
    effect(bundle, { id: "effect:override-b", metric: "damage_bonus", operation: "override", value: { base: 0.4, scaling: [] } }),
    effect(bundle, { id: "effect:crit-a", metric: "critical_rate", operation: "percent", value: { base: 0.8, scaling: [] } }),
    effect(bundle, { id: "effect:crit-b", metric: "critical_rate", operation: "percent", value: { base: 0.5, scaling: [] } }),
  ];
  window.location.hash = "#/simulator";
  renderHashPage(bundle);
  await user.selectOptions(screen.getByLabelText("1号位角色"), "character:support");

  const groups = screen.getByRole("region", { name: "applied groups · 已应用汇总" });
  expect(within(groups).getByText("全队（slot-1） · 增伤 · percent")).toBeVisible();
  expect(within(groups).getByText("应用值：+20%、+30% · 合计：+50%")).toBeVisible();
  expect(within(groups).getByText("应用值：×1.2、×1.5 · 合计：×1.8")).toBeVisible();
  expect(within(groups).getByText("应用值：设为 0.3、设为 0.4 · 合计：设为 0.4")).toBeVisible();
  expect(within(groups).getByText("上限：100%")).toBeVisible();
  expect(screen.getByRole("list", { name: "评估警告" })).toHaveTextContent("Conflicting overrides");
  expect(screen.getByRole("list", { name: "评估警告" })).toHaveTextContent("critical_rate exceeds its cap");
});

test("real HashRouter follows malformed, stale, valid, back, and clear URL transitions without loops", async () => {
  const bundle = reviewBundle();
  const user = userEvent.setup();
  window.location.hash = "#/simulator";
  renderHashPage(bundle);

  const valid = encodeTeamBuild({
    releaseId: bundle.release.id,
    members: [{ slotId: "slot-1", characterLogicalId: "character:support", eidolon: 0 }],
  });
  act(() => { window.location.hash = `#/simulator?build=${valid}`; });
  await waitFor(() => expect(screen.getByLabelText("1号位角色")).toHaveValue("character:support"));

  act(() => { window.location.hash = "#/simulator?build=not-json"; });
  expect(await screen.findByRole("alert")).toHaveTextContent("构筑链接");

  const stale = encodeTeamBuild({
    releaseId: "release-4.2",
    members: [{ slotId: "slot-1", characterLogicalId: "character:support", eidolon: 0 }],
  });
  act(() => { window.location.hash = `#/simulator?build=${stale}`; });
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("release-4.2"));

  act(() => { window.history.back(); });
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("构筑链接"));
  act(() => { window.history.back(); });
  await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
  expect(screen.getByLabelText("1号位角色")).toHaveValue("character:support");

  act(() => { window.location.hash = "#/simulator?build=broken-again"; });
  await screen.findByRole("alert");
  await user.click(screen.getByRole("button", { name: "清除链接并重新构筑" }));
  await waitFor(() => expect(window.location.hash).toBe("#/simulator"));
  expect(screen.getByLabelText("1号位角色")).toHaveValue("");

  act(() => { window.location.hash = `#/simulator?build=${valid}`; });
  await waitFor(() => expect(screen.getByLabelText("1号位角色")).toHaveValue("character:support"));
  await user.selectOptions(screen.getByLabelText("1号位角色"), "");
  await waitFor(() => expect(window.location.hash).toBe("#/simulator"));
});

test("character builder rejects a multi-member share before evaluating hidden members", async () => {
  const bundle = reviewBundle();
  const shared = encodeTeamBuild({
    releaseId: bundle.release.id,
    members: [
      { slotId: "slot-1", characterLogicalId: "character:support", eidolon: 0 },
      { slotId: "slot-2", characterLogicalId: "character:dps", eidolon: 0 },
    ],
  });
  window.location.hash = `#/builds?build=${shared}`;
  renderHashPage(bundle, "builds");

  expect(await screen.findByRole("alert")).toHaveTextContent("角色构筑最多允许 1 名角色");
  expect(screen.getByLabelText("1号位角色")).toHaveValue("");
  expect(screen.getByText(/选择角色后显示效果/)).toBeVisible();
});

test("fresh battle, action, and event triggers are explicit one-shot evaluations that can be replayed", async () => {
  const user = userEvent.setup();
  const bundle = reviewBundle();
  bundle.entities.effects = [
    effect(bundle, { id: "effect:battle-once", metric: "attack", trigger: { type: "battle-start" }, duration: { type: "instant" } }),
    effect(bundle, {
      id: "effect:action-once", metric: "speed", operation: "flat", value: { base: 10, scaling: [] },
      trigger: { type: "action" }, duration: { type: "instant" },
    }),
    effect(bundle, { id: "effect:event-once", trigger: { type: "event", event: "skill-active" }, duration: { type: "instant" } }),
  ];
  window.location.hash = "#/simulator";
  renderHashPage(bundle);
  await user.selectOptions(screen.getByLabelText("1号位角色"), "character:support");
  await user.click(screen.getByText("场景条件"));
  await user.type(screen.getByLabelText("历史事件"), "skill-active");

  await user.click(screen.getByRole("button", { name: "触发战斗开始一次" }));
  expect(screen.getByText("全队攻击力 +10%")).toBeVisible();
  await user.click(screen.getByLabelText("敌人处于弱点击破"));
  expect(screen.queryByText("全队攻击力 +10%")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "触发行动一次" }));
  expect(screen.getByText("全队速度 +10")).toBeVisible();
  await user.click(screen.getByLabelText("敌人处于弱点击破"));
  expect(screen.queryByText("全队速度 +10")).not.toBeInTheDocument();

  await user.click(screen.getByText("inactive · 未生效"));
  expect(screen.getByText("原因：指定事件尚未触发")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "触发这些事件一次" }));
  expect(screen.getByText("全队增伤 +10%")).toBeVisible();
  await user.click(screen.getByLabelText("敌人处于弱点击破"));
  expect(screen.getByText("原因：指定事件尚未触发")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "触发这些事件一次" }));
  expect(screen.getByText("全队增伤 +10%")).toBeVisible();
});

test("all three relic selections from a shared build remain visible and independently editable", async () => {
  const user = userEvent.setup();
  const bundle = reviewBundle();
  const shared = encodeTeamBuild({
    releaseId: bundle.release.id,
    members: [{
      slotId: "slot-1", characterLogicalId: "character:support", eidolon: 0,
      relicSets: [
        { logicalId: "relic-set:test-1", pieces: 2 },
        { logicalId: "relic-set:test-2", pieces: 4 },
        { logicalId: "relic-set:test-3", pieces: 2 },
      ],
    }],
  });
  window.location.hash = `#/simulator?build=${shared}`;
  renderHashPage(bundle);

  const first = await screen.findByLabelText("测试辅助遗器套装 1");
  const second = screen.getByLabelText("测试辅助遗器套装 2");
  const third = screen.getByLabelText("测试辅助遗器套装 3");
  expect(first).toHaveValue("relic-set:test-1");
  expect(second).toHaveValue("relic-set:test-2");
  expect(third).toHaveValue("relic-set:test-3");

  await user.selectOptions(second, "");
  expect(first).toHaveValue("relic-set:test-1");
  expect(second).toHaveValue("relic-set:test-3");
  expect(third).toHaveValue("");
  expect((screen.getByLabelText(/分享链接/) as HTMLInputElement).value).toContain("relic-set%3Atest-3");
});

test("evidence dialog traps Tab and Shift+Tab while preserving Escape focus restoration", async () => {
  const user = userEvent.setup();
  const bundle = reviewBundle();
  bundle.entities.effects = [effect(bundle, { id: "effect:evidence" })];
  window.location.hash = "#/simulator";
  renderHashPage(bundle);
  await user.selectOptions(screen.getByLabelText("1号位角色"), "character:support");
  const opener = screen.getByRole("button", { name: "查看全队增伤来源" });
  await user.click(opener);

  const dialog = screen.getByRole("dialog", { name: "效果证据" });
  expect(dialog).toHaveFocus();
  await user.tab();
  expect(within(dialog).getByRole("button", { name: "关闭" })).toHaveFocus();
  await user.tab({ shift: true });
  expect(within(dialog).getByRole("link")).toHaveFocus();
  await user.keyboard("{Escape}");
  expect(opener).toHaveFocus();
});

test("release provider exposes loading and load failures accessibly", async () => {
  let rejectFetch!: (error: Error) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((_resolve, reject) => { rejectFetch = reject; })));
  window.location.hash = "#/simulator";
  render(
    <HashRouter><Routes><Route path="/simulator" element={<ReleaseProvider><TeamSimulatorPage /></ReleaseProvider>} /></Routes></HashRouter>,
  );
  expect(screen.getByRole("status")).toHaveTextContent("正在加载版本资料");
  rejectFetch(new Error("release unavailable"));
  expect(await screen.findByRole("alert")).toHaveTextContent("release unavailable");
});

test("empty relic slots cannot create sparse build state by activating slot two or three first", async () => {
  const user = userEvent.setup();
  const bundle = reviewBundle();
  window.location.hash = "#/simulator";
  renderHashPage(bundle);
  await user.selectOptions(screen.getByLabelText("1号位角色"), "character:support");

  const second = screen.getByLabelText("测试辅助遗器套装 2");
  const third = screen.getByLabelText("测试辅助遗器套装 3");
  expect(second).toBeDisabled();
  expect(third).toBeDisabled();
  expect(() => fireEvent.change(third, { target: { value: "relic-set:test-3" } })).not.toThrow();
  expect(second).toHaveValue("");
  expect(third).toHaveValue("");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();

  await user.selectOptions(screen.getByLabelText("测试辅助遗器套装 1"), "relic-set:test-1");
  expect(second).toBeEnabled();
  expect(third).toBeDisabled();
});

test("a one-shot fired before its source enters the build is consumed and not reused", async () => {
  const user = userEvent.setup();
  const bundle = reviewBundle();
  bundle.entities.effects = [effect(bundle, {
    id: "effect:late-battle", metric: "attack", trigger: { type: "battle-start" }, duration: { type: "instant" },
  })];
  window.location.hash = "#/simulator";
  renderHashPage(bundle);
  await user.click(screen.getByText("场景条件"));
  await user.click(screen.getByRole("button", { name: "触发战斗开始一次" }));
  await user.selectOptions(screen.getByLabelText("1号位角色"), "character:support");
  expect(screen.queryByText("全队攻击力 +10%")).not.toBeInTheDocument();
  await user.click(screen.getByText("inactive · 未生效"));
  expect(screen.getByText("原因：战斗尚未开始")).toBeVisible();
});

test("external URL navigation consumes a one-shot without reusing it in the incoming build", async () => {
  const user = userEvent.setup();
  const bundle = reviewBundle();
  bundle.entities.effects = [effect(bundle, {
    id: "effect:url-battle", metric: "attack", trigger: { type: "battle-start" }, duration: { type: "instant" },
  })];
  const dps = encodeTeamBuild({
    releaseId: bundle.release.id,
    members: [{ slotId: "slot-1", characterLogicalId: "character:dps", eidolon: 0 }],
  });
  const support = encodeTeamBuild({
    releaseId: bundle.release.id,
    members: [{ slotId: "slot-1", characterLogicalId: "character:support", eidolon: 0 }],
  });
  window.location.hash = `#/simulator?build=${dps}`;
  renderHashPage(bundle);
  await waitFor(() => expect(screen.getByLabelText("1号位角色")).toHaveValue("character:dps"));
  await user.click(screen.getByText("场景条件"));
  await user.click(screen.getByRole("button", { name: "触发战斗开始一次" }));

  act(() => { window.location.hash = `#/simulator?build=${support}`; });
  await waitFor(() => expect(screen.getByLabelText("1号位角色")).toHaveValue("character:support"));
  expect(screen.queryByText("全队攻击力 +10%")).not.toBeInTheDocument();
  await user.click(screen.getByText("inactive · 未生效"));
  expect(screen.getByText("原因：战斗尚未开始")).toBeVisible();
});

test("aggregation formatting follows operation semantics instead of metric guesses", async () => {
  const user = userEvent.setup();
  const bundle = reviewBundle();
  bundle.entities.effects = [
    effect(bundle, { id: "effect:attack-flat", metric: "attack", operation: "flat", value: { base: 100, scaling: [] } }),
    effect(bundle, { id: "effect:hp-flat", metric: "hp", operation: "flat", value: { base: 500, scaling: [] } }),
    effect(bundle, { id: "effect:defense-flat", metric: "defense", operation: "flat", value: { base: 80, scaling: [] } }),
    effect(bundle, { id: "effect:healing-flat", metric: "healing", operation: "flat", value: { base: 0.25, scaling: [] } }),
    effect(bundle, { id: "effect:shield-flat", metric: "shielding", operation: "flat", value: { base: 200, scaling: [] } }),
    effect(bundle, { id: "effect:speed-percent", metric: "speed", operation: "percent", value: { base: 0.1, scaling: [] } }),
  ];
  window.location.hash = "#/simulator";
  renderHashPage(bundle);
  await user.selectOptions(screen.getByLabelText("1号位角色"), "character:support");

  const groups = screen.getByRole("region", { name: "applied groups · 已应用汇总" });
  for (const [label, rendered] of [
    ["攻击力", "+100"], ["生命值", "+500"], ["防御力", "+80"],
    ["治疗", "+0.25"], ["护盾", "+200"], ["速度", "+10%"],
  ]) {
    const item = within(groups).getByText(new RegExp(`· ${label} ·`)).closest("li");
    expect(item).toHaveTextContent(`应用值：${rendered} · 合计：${rendered}`);
  }
});
