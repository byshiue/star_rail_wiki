import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, vi } from "vitest";
import entitiesJson from "../../data/fixtures/release-4.3/entities.json";
import releaseJson from "../../data/fixtures/release-4.3/release.json";
import { ReleaseProvider } from "../app/ReleaseProvider";
import type { CharacterRevision, EquipmentRevision, FeatureRevision } from "../domain/entities";
import type { Effect } from "../domain/effects";
import { GameReleaseBundleSchema, type GameReleaseBundle } from "../domain/releases";
import { TeamBuildValidationError } from "../effects/evaluateTeam";
import { decodeTeamBuild, encodeTeamBuild, validateTeamBuild } from "./teamBuild";
import { TeamSimulatorPage } from "./TeamSimulatorPage";

afterEach(() => {
  vi.unstubAllGlobals();
  window.location.hash = "";
});

function releasedBundle(): GameReleaseBundle {
  const parsed = GameReleaseBundleSchema.parse({ release: releaseJson, entities: entitiesJson });
  const provenance = [{
    sourceName: "正式服资料源", sourceUrl: "https://example.com/star-rail/4.3",
    sourceRevision: "43acb123", sourcePath: "characters/support.json", sourceChecksum: "sha256:test",
  }];
  const releaseId = "release-4.3";
  const feature = (
    logicalId: string, revisionId: string, name: string, kind: string, effectIds: string[],
  ): FeatureRevision => ({
    logicalId, revisionId, name, kind, effectIds, provenance,
    validFromReleaseId: releaseId, validToReleaseId: null, originalText: `${name}原文。`, reviewStatus: "reviewed",
  });
  const character = (logicalId: string, name: string, path: string): CharacterRevision => ({
    logicalId, revisionId: `${logicalId}@4.3`, validFromReleaseId: releaseId, validToReleaseId: null,
    provenance, name, rarity: 5, element: "虚数", path, roleAnnotation: { characterLogicalId: logicalId, releaseId, classificationOwner: "star-rail-wiki", roles: path === "destruction" ? ["damage"] : ["support"], archetypes: ["general"], reviewStatus: "reviewed", reviewer: { name: "test reviewer", reviewedAt: "2026-08-21T00:00:00.000Z" }, provenance }, description: `${name}测试资料。`,
    reviewStatus: "reviewed", abilities: [], traces: [], eidolons: [],
  });
  const dps = character("character:dps", "测试输出", "destruction");
  const support = character("character:support", "测试辅助", "harmony");
  const supportTwo = character("character:support-2", "测试辅助二", "nihility");
  const sustain = character("character:sustain", "测试生存", "preservation");
  supportTwo.element = "雷";
  support.eidolons = [feature(
    "eidolon:support-1", "eidolon:support-1@4.3", "全队增伤", "eidolon",
    ["effect:team-damage", "effect:unclassified-eidolon"],
  )];
  support.abilities = [feature(
    "ability:support-override", "ability:support-override@4.3", "暴伤设定", "ability",
    ["effect:support-critical-damage", "effect:support-self-critical-damage"],
  )];
  supportTwo.abilities = [feature(
    "ability:support-2-override", "ability:support-2-override@4.3", "暴伤设定二", "ability",
    ["effect:support-2-critical-damage"],
  )];
  const equipment: EquipmentRevision[] = [
    {
      logicalId: "light-cone:harmony", revisionId: "light-cone:harmony@4.3", validFromReleaseId: releaseId,
      validToReleaseId: null, provenance, kind: "light-cone", name: "同谐光锥", rarity: 5,
      description: "同谐命途光锥。", pathRestriction: "harmony", superimpositionValues: [0.1, 0.2],
      setThresholds: [], effectIds: [], reviewStatus: "reviewed",
    },
    {
      logicalId: "light-cone:destruction", revisionId: "light-cone:destruction@4.3", validFromReleaseId: releaseId,
      validToReleaseId: null, provenance, kind: "light-cone", name: "毁灭光锥", rarity: 5,
      description: "毁灭命途光锥。", pathRestriction: "destruction", superimpositionValues: [0.1],
      setThresholds: [], effectIds: [], reviewStatus: "reviewed",
    },
    {
      logicalId: "relic-set:team", revisionId: "relic-set:team@4.3", validFromReleaseId: releaseId,
      validToReleaseId: null, provenance, kind: "relic-set", name: "测试遗器", rarity: null,
      description: "测试遗器套装。", pathRestriction: null, superimpositionValues: [],
      setThresholds: [2, 4], effectIds: [], reviewStatus: "reviewed",
    },
  ];
  const effect: Effect = {
    id: "effect:team-damage", sourceRevisionId: "eidolon:support-1@4.3", metric: "damage_bonus",
    operation: "percent", value: { base: 0.5, scaling: [] }, target: { type: "team" },
    trigger: { type: "always" }, duration: { type: "permanent" }, stacking: { type: "none", maxStacks: 1 },
    conditions: [], dispellable: null, reviewStatus: "reviewed", originalText: "使我方全体造成的伤害提高50%。",
  };
  const supportCriticalDamage: Effect = {
    id: "effect:support-critical-damage", sourceRevisionId: "ability:support-override@4.3",
    metric: "critical_damage", operation: "override", value: { base: 0.2, scaling: [] },
    target: { type: "team" }, trigger: { type: "always" }, duration: { type: "permanent" },
    stacking: { type: "none", maxStacks: 1 }, conditions: [], dispellable: null,
    reviewStatus: "reviewed", originalText: "使我方全体暴击伤害设为20%。",
  };
  const unclassifiedEidolon: Effect = {
    id: "effect:unclassified-eidolon", sourceRevisionId: "eidolon:support-1@4.3",
    metric: "unclassified_numeric", operation: "flat", value: { base: 7, scaling: [] },
    target: { type: "self" }, trigger: { type: "always" }, duration: { type: "permanent" },
    stacking: { type: "none", maxStacks: 1 }, conditions: [], dispellable: null,
    reviewStatus: "unsupported", originalText: "测试尚未分类的星魂数值。",
  };
  const supportSelfCriticalDamage: Effect = {
    id: "effect:support-self-critical-damage", sourceRevisionId: "ability:support-override@4.3",
    metric: "critical_damage", operation: "override", value: { base: 0.6, scaling: [] },
    target: { type: "self" }, trigger: { type: "always" }, duration: { type: "permanent" },
    stacking: { type: "none", maxStacks: 1 }, conditions: [], dispellable: null,
    reviewStatus: "reviewed", originalText: "使自身暴击伤害设为60%。",
  };
  const supportTwoCriticalDamage: Effect = {
    id: "effect:support-2-critical-damage", sourceRevisionId: "ability:support-2-override@4.3",
    metric: "critical_damage", operation: "override", value: { base: 0.4, scaling: [] },
    target: { type: "team" }, trigger: { type: "always" }, duration: { type: "permanent" },
    stacking: { type: "none", maxStacks: 1 }, conditions: [], dispellable: null,
    reviewStatus: "reviewed", originalText: "使我方全体暴击伤害设为40%。",
  };
  return {
    release: {
      ...parsed.release, id: releaseId, gameVersion: "4.3", channel: "released",
      sources: parsed.release.sources.map((source) => ({ ...source, name: "正式服资料源", url: "https://example.com/star-rail/4.3" })),
    },
    entities: { characters: [dps, support, supportTwo, sustain], equipment,
      effects: [effect, unclassifiedEidolon, supportCriticalDamage, supportSelfCriticalDamage,
        supportTwoCriticalDamage] },
  };
}

function renderSimulator(bundle = releasedBundle(), route = "/simulator") {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <ReleaseProvider bundle={bundle}><TeamSimulatorPage /></ReleaseProvider>
    </MemoryRouter>,
  );
}

test("share payload uses stable logical IDs and rejects extra revision fields", () => {
  const build = {
    releaseId: "release-4.3",
    members: [{
      slotId: "slot-1", characterLogicalId: "character:support", eidolon: 1,
      lightCone: { logicalId: "light-cone:harmony", superimposition: 2 },
      relicSets: [{ logicalId: "relic-set:team", pieces: 4 }],
    }],
  };

  const encoded = encodeTeamBuild(build);

  expect(decodeTeamBuild(encoded)).toEqual(build);
  expect(encoded).not.toContain("测试辅助");
  expect(() => decodeTeamBuild(encodeURIComponent(JSON.stringify({
    ...build, members: [{ ...build.members[0], characterRevisionId: "character:support@4.3" }],
  })))).toThrow(/构筑链接/);
});

test("validation rejects duplicate characters and incompatible light cones before evaluation", () => {
  const bundle = releasedBundle();
  const build = {
    releaseId: bundle.release.id,
    members: [
      {
        slotId: "slot-1", characterLogicalId: "character:support", eidolon: 0,
        lightCone: { logicalId: "light-cone:destruction", superimposition: 1 },
      },
      { slotId: "slot-2", characterLogicalId: "character:support", eidolon: 0 },
    ],
  };

  expect(() => validateTeamBuild(build, bundle)).toThrow(TeamBuildValidationError);
  try {
    validateTeamBuild(build, bundle);
  } catch (error) {
    expect(error).toBeInstanceOf(TeamBuildValidationError);
    expect((error as TeamBuildValidationError).issues.map((issue) => issue.code)).toEqual([
      "illegal_equipment", "duplicate_character",
    ]);
  }
});

test("changing an eidolon recomputes buffs and preserves release provenance", async () => {
  const user = userEvent.setup();
  renderSimulator();
  await user.selectOptions(screen.getByLabelText("1号位角色"), "character:support");

  expect(screen.queryByText("全队增伤 +50%")).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("测试辅助星魂"), "1");

  const breakdown = screen.getByRole("region", { name: "当前 Buff 汇总" });
  const contributions = within(breakdown).getByRole("list", { name: "全队增伤角色贡献" });
  const group = contributions.closest(".buff-group") as HTMLElement;
  expect(within(group).getByText("测试辅助 E1")).toBeVisible();
  expect(within(group).getByText("叠加后总值 +50%")).toBeVisible();
  expect(within(group).getByText("提供 +50%")).toBeVisible();
  expect(screen.getByText("全队增伤 +50%")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "查看全队增伤来源" }));
  const dialog = screen.getByRole("dialog", { name: "效果证据" });
  expect(dialog).toHaveFocus();
  expect(within(dialog).getByText("正式服 4.3")).toBeVisible();
  expect(screen.getByText("eidolon:support-1@4.3")).toBeVisible();
  expect(screen.getByRole("link", { name: "正式服资料源" })).toHaveAttribute("href", "https://example.com/star-rail/4.3");

  await user.keyboard("{Escape}");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "查看全队增伤来源" })).toHaveFocus();
});


test("keeps locked and unsupported effects in collapsed localized audit details", async () => {
  const user = userEvent.setup();
  renderSimulator();
  await user.selectOptions(screen.getByLabelText("1号位角色"), "character:support");

  const inactiveLabel = screen.getByText("inactive · 未生效");
  const inactiveDetails = inactiveLabel.closest("details");
  expect(inactiveDetails).not.toBeNull();
  expect(inactiveDetails).not.toHaveAttribute("open");
  expect(within(inactiveDetails as HTMLElement).getByText("自身未分类数值机制")).not.toBeVisible();

  await user.click(inactiveLabel);

  expect(inactiveDetails).toHaveAttribute("open");
  expect(within(inactiveDetails as HTMLElement).getAllByText("原因：需要更高星魂")).toHaveLength(2);
  expect(screen.queryByText(/unclassified_numeric|eidolon_locked/)).not.toBeInTheDocument();

  await user.selectOptions(screen.getByLabelText("测试辅助星魂"), "1");
  const unsupportedLabel = screen.getByText("unsupported · 不支持");
  const unsupportedDetails = unsupportedLabel.closest("details");
  expect(unsupportedDetails).not.toBeNull();
  expect(unsupportedDetails).not.toHaveAttribute("open");

  const appliedGroups = screen.getByRole("heading", { name: "applied groups · 已应用汇总" }).closest("section");
  expect(appliedGroups).not.toBeNull();
  expect(within(appliedGroups as HTMLElement).queryByText(/未分类数值机制|\+7/)).not.toBeInTheDocument();

  await user.click(unsupportedLabel);
  expect(unsupportedDetails).toHaveAttribute("open");
  expect(within(unsupportedDetails as HTMLElement).getByText("自身未分类数值机制")).toBeVisible();
  expect(within(unsupportedDetails as HTMLElement).getByText("原因：该效果尚不支持模拟")).toBeVisible();

  await user.click(screen.getByRole("button", { name: "查看自身未分类数值机制来源" }));
  const dialog = screen.getByRole("dialog", { name: "效果证据" });
  expect(within(dialog).getByText("测试尚未分类的星魂数值。")).toBeVisible();
});

test("overlapping character buffs show every contribution and the applied rule", async () => {
  const user = userEvent.setup();
  renderSimulator();
  await user.selectOptions(screen.getByLabelText("1号位角色"), "character:support");
  await user.selectOptions(screen.getByLabelText("2号位角色"), "character:support-2");

  const contributions = screen.getByRole("list", { name: "全队暴击伤害角色贡献" });
  const group = contributions.closest(".buff-group");
  expect(group).not.toBeNull();
  expect(within(group as HTMLElement).getByText("测试辅助 E0")).toBeVisible();
  expect(within(group as HTMLElement).getByText("提供 设为 0.2")).toBeVisible();
  expect(within(group as HTMLElement).getByText("测试辅助二 E0")).toBeVisible();
  expect(within(group as HTMLElement).getByText("提供 设为 0.4")).toBeVisible();
  expect(within(group as HTMLElement).getByText("叠加后总值 设为 0.4")).toBeVisible();
  expect(within(group as HTMLElement).getByText("取最高")).toBeVisible();
});


test("self and team buffs stay separate when they resolve to the same member", async () => {
  const user = userEvent.setup();
  renderSimulator();
  await user.selectOptions(screen.getByLabelText("1号位角色"), "character:support");

  const team = screen.getByRole("list", { name: "全队暴击伤害角色贡献" });
  const self = screen.getByRole("list", { name: "自身暴击伤害角色贡献" });
  expect(within(team.closest(".buff-group") as HTMLElement)
    .getByText("叠加后总值 设为 0.2")).toBeVisible();
  expect(within(self.closest(".buff-group") as HTMLElement)
    .getByText("叠加后总值 设为 0.6")).toBeVisible();
});

test("filters character candidates by path and element without removing selected members", async () => {
  const user = userEvent.setup();
  renderSimulator();
  await user.selectOptions(screen.getByLabelText("1号位角色"), "character:support");

  await user.selectOptions(screen.getByLabelText("命途筛选"), "nihility");
  await user.selectOptions(screen.getByLabelText("属性筛选"), "雷");

  expect(screen.getByLabelText("1号位角色")).toHaveValue("character:support");
  expect(within(screen.getByLabelText("1号位角色")).getByRole("option", { name: "测试辅助" }))
    .toBeInTheDocument();
  const secondSlot = screen.getByLabelText("2号位角色");
  expect(within(secondSlot).getByRole("option", { name: "测试辅助二" })).toBeInTheDocument();
  expect(within(secondSlot).queryByRole("option", { name: "测试输出" })).not.toBeInTheDocument();

  await user.selectOptions(screen.getByLabelText("命途筛选"), "");
  await user.selectOptions(screen.getByLabelText("属性筛选"), "");

  expect(within(secondSlot).getByRole("option", { name: "测试输出" })).toBeInTheDocument();
});
test("malformed and stale hash builds show a recoverable accessible error", async () => {
  const user = userEvent.setup();
  renderSimulator(releasedBundle(), "/simulator?build=not-json");

  expect(screen.getByRole("alert")).toHaveTextContent("构筑链接");
  await user.click(screen.getByRole("button", { name: "清除链接并重新构筑" }));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();

  const stale = encodeTeamBuild({
    releaseId: "release-4.2", members: [{ slotId: "slot-1", characterLogicalId: "character:support", eidolon: 0 }],
  });
  renderSimulator(releasedBundle(), `/simulator?build=${stale}`);
  expect(screen.getByRole("alert")).toHaveTextContent("版本 release-4.2");
});

test("a null current release renders an honest empty state", async () => {
  const emptyIndex = { currentReleaseId: null, releases: [releasedBundle().release] };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(emptyIndex), {
    status: 200, headers: { "Content-Type": "application/json" },
  })));

  render(<MemoryRouter><ReleaseProvider><TeamSimulatorPage /></ReleaseProvider></MemoryRouter>);

  expect(screen.getByRole("status")).toHaveTextContent("正在加载版本资料");
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("暂无已发布版本"));
});
