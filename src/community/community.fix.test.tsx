import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useRoutes } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import { appRoutes } from "../app/routes";
import { ReleaseProvider } from "../app/ReleaseProvider";
import type { TeamPreset } from "../domain/community";
import type { CharacterRevision } from "../domain/entities";
import type { TeamMemberBuild } from "../effects/evaluateTeam";
import type { GameReleaseBundle } from "../domain/releases";
import { decodeTeamBuild, encodeTeamBuild } from "../simulator/teamBuild";
import { useTeamBuild } from "../simulator/useTeamBuild";
import { CommunityTeamsPage } from "./CommunityTeamsPage";
import {
  createTeamBuildFromPreset, loadCommunityTeamLibrary, loadCommunityTeams, validatePresetForBundle,
} from "./teamRepository";

afterEach(() => vi.unstubAllGlobals());

const provenance = [{
  sourceName: "测试资料源", sourceUrl: "https://example.com/release-4.3",
  sourceRevision: "43acb123", sourcePath: "characters.json", sourceChecksum: "sha256:test",
}];

function releasedBundle(): GameReleaseBundle {
  const character = (logicalId: string, name: string): CharacterRevision => ({
    logicalId, revisionId: `${logicalId}@release-4.3`, validFromReleaseId: "release-4.3",
    validToReleaseId: null, provenance, name, rarity: 5, element: "虚数", path: "harmony", roleAnnotation: { characterLogicalId: logicalId, releaseId: "release-4.3", classificationOwner: "star-rail-wiki", roles: ["support"], archetypes: ["general"], reviewStatus: "reviewed", reviewer: { name: "test reviewer", reviewedAt: "2026-08-21T00:00:00.000Z" }, provenance },
    description: `${name}测试资料。`, reviewStatus: "reviewed", abilities: [], traces: [], eidolons: [],
  });
  return {
    release: {
      id: "release-4.3", gameVersion: "4.3", region: "cn", channel: "released",
      importedAt: "2026-08-20T00:00:00.000Z", reviewedAt: "2026-08-21T00:00:00.000Z",
      sources: [{
        name: "测试资料源", url: "https://example.com/release-4.3", revision: "43acb123",
        fileChecksums: { "characters.json": "sha256:test" }, retrievedAt: "2026-08-21T00:00:00.000Z",
      }],
      previousReleaseId: null,
    },
    entities: {
      characters: [
        character("character:a", "甲"), character("character:b", "乙"),
        character("character:c", "丙"), character("character:d", "丁"), character("character:e", "戊"),
      ],
      equipment: [], effects: [],
    },
  };
}

function preset(overrides: Partial<TeamPreset> = {}): TeamPreset {
  return {
    id: "team:reviewed-follow-up", releaseId: "release-4.3", gameVersion: "4.3", channel: "released",
    slots: ["character:a", "character:b", "character:c", "character:d"],
    memberAssumptions: [
      { eidolon: 0, equipment: { status: "none", reason: "来源未指定光锥" } },
      { eidolon: 0, equipment: { status: "none", reason: "来源未指定光锥" } },
      { eidolon: 0, equipment: { status: "none", reason: "来源未指定光锥" } },
      { eidolon: 0, equipment: { status: "none", reason: "来源未指定光锥" } },
    ],
    substitutions: [{ slot: 1, characterLogicalId: "character:e", note: "缺少乙时可换用戊。" }],
    requirements: ["全员零星魂", "不依赖限定光锥"], investment: "low", tags: ["追击", "低配"],
    summary: "项目根据来源整理的代表性追击队摘要。",
    source: {
      url: "https://example.com/community/team-guide", title: "4.3 Team Guide",
      author: "Guide Author", publisher: "Community Publisher",
      publication: { status: "published", publishedAt: "2026-08-20T00:00:00.000Z" },
      retrievedAt: "2026-08-21T00:00:00.000Z", availability: "available",
    },
    ...overrides,
  };
}

function library(...presets: TeamPreset[]) {
  return { schemaVersion: 1, libraryKind: "mixed", currentReleaseId: "release-4.3", presets };
}

function fetchFor(bundle: GameReleaseBundle, communityLibrary = library(preset())) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("data/releases/index.json")) return new Response(JSON.stringify({
      currentReleaseId: bundle.release.id, releases: [bundle.release],
    }), { status: 200 });
    if (url.endsWith("data/releases/release-4.3/release.json")) return new Response(JSON.stringify(bundle.release));
    if (url.endsWith("data/releases/release-4.3/entities.json")) return new Response(JSON.stringify(bundle.entities));
    if (url.endsWith("data/community/teams.json")) return new Response(JSON.stringify(communityLibrary));
    return new Response(null, { status: 404 });
  });
}

function RouteHarness() { return useRoutes(appRoutes); }

test("fetch repository rejects malformed/error payloads and returns deterministic clones", async () => {
  const second = preset({ id: "team:z-last" });
  const first = preset({ id: "team:a-first" });
  const fetchStub = vi.fn().mockImplementation(async () => (
    new Response(JSON.stringify(library(second, first)))
  ));
  vi.stubGlobal("fetch", fetchStub);

  await expect(loadCommunityTeamLibrary()).resolves.toEqual([
    expect.objectContaining({ id: "team:a-first" }),
    expect.objectContaining({ id: "team:z-last" }),
  ]);
  await expect(loadCommunityTeams("release-4.3")).resolves.toHaveLength(2);
  expect(fetchStub).toHaveBeenCalledWith("/data/community/teams.json");

  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}")));
  await expect(loadCommunityTeamLibrary()).rejects.toThrow();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 503 })));
  await expect(loadCommunityTeamLibrary()).rejects.toThrow(/503/);
});

test("share round-trip preserves every structured preset assumption", () => {
  const teamPreset = preset();
  const build = createTeamBuildFromPreset(teamPreset, releasedBundle());
  const decoded = decodeTeamBuild(encodeTeamBuild(build));

  expect(decoded.communityPreset).toEqual({
    presetId: teamPreset.id, investment: "low", requirements: teamPreset.requirements,
    slots: teamPreset.slots,
    substitutions: teamPreset.substitutions, memberAssumptions: teamPreset.memberAssumptions,
  });
  expect(decoded.members.map((member) => member.eidolon)).toEqual([0, 0, 0, 0]);
});

test("crafted community metadata must agree with shared members", () => {
  const build = createTeamBuildFromPreset(preset(), releasedBundle());
  const tampered = structuredClone(build);
  tampered.members[0]!.eidolon = 1;
  const crafted = encodeURIComponent(JSON.stringify(tampered));

  expect(() => decodeTeamBuild(crafted)).toThrow(/构筑链接/);
  expect(() => encodeTeamBuild(tampered)).toThrow(/构筑链接/);
});

test("every member, eidolon, equipment, or relic edit clears community provenance", () => {
  const bundle = releasedBundle();
  const build = createTeamBuildFromPreset(preset(), bundle);
  const { result } = renderHook(() => useTeamBuild(bundle, {}, build));
  const edits: Array<Partial<TeamMemberBuild>> = [
    { characterLogicalId: "character:a" },
    { eidolon: 0 },
    { lightCone: undefined },
    { relicSets: [] },
    { skillLevels: { "ability:a": 1 } },
  ];

  for (const edit of edits) {
    act(() => result.current.replaceBuild(build));
    act(() => result.current.updateMember(1, edit));
    expect(result.current.build.communityPreset).toBeUndefined();
  }
});

test("app route reloads the release provider, decodes handoff, and shows preset assumptions", async () => {
  const user = userEvent.setup();
  const bundle = releasedBundle();
  const fetchStub = fetchFor(bundle);
  vi.stubGlobal("fetch", fetchStub);

  render(<MemoryRouter initialEntries={["/community"]}><RouteHarness /></MemoryRouter>);
  expect(await screen.findByRole("heading", { name: "社区配队" })).toBeVisible();
  await user.click(await screen.findByRole("button", { name: "载入配队实验室" }));

  expect(await screen.findByRole("heading", { name: "配队实验室" })).toBeVisible();
  expect(screen.getByLabelText("1号位角色")).toHaveValue("character:a");
  expect(screen.getByRole("region", { name: "社区预设假设" })).toHaveTextContent("team:reviewed-follow-up");
  expect(screen.getByRole("region", { name: "社区预设假设" })).toHaveTextContent("全员零星魂");
  expect(screen.getByRole("region", { name: "社区预设假设" })).toHaveTextContent("缺少乙时可换用戊");
  expect(fetchStub.mock.calls.filter(([url]) => String(url).endsWith("data/releases/index.json")).length).toBeGreaterThanOrEqual(2);

  await user.selectOptions(screen.getByLabelText("1号位角色"), "character:e");
  expect(screen.queryByRole("region", { name: "社区预设假设" })).not.toBeInTheDocument();
  await waitFor(() => {
    const value = (screen.getByLabelText(/分享链接/) as HTMLInputElement).value;
    const payload = new URLSearchParams(value.split("?")[1]).get("build");
    expect(decodeTeamBuild(payload!).communityPreset).toBeUndefined();
  });
  const shareUrl = (screen.getByLabelText(/分享链接/) as HTMLInputElement).value;
  const encodedBuild = new URLSearchParams(shareUrl.split("?")[1]).get("build");
  expect(encodedBuild).not.toBeNull();
  expect(decodeTeamBuild(encodedBuild!).communityPreset).toBeUndefined();
});

test("unavailable presets keep provenance text but expose no active source or handoff", async () => {
  const unavailable = preset({ source: { ...preset().source, availability: "unavailable" } });
  render(<MemoryRouter><ReleaseProvider bundle={releasedBundle()}>
    <CommunityTeamsPage loadPresets={async () => [unavailable]} />
  </ReleaseProvider></MemoryRouter>);

  expect(await screen.findByText(/来源当前不可用/)).toBeVisible();
  expect(screen.getByText(/4.3 Team Guide/)).toBeVisible();
  expect(screen.queryByRole("link", { name: /4.3 Team Guide/ })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "载入配队实验室" })).toBeDisabled();
});

test("load failure renders one alert without a simultaneous empty-result state", async () => {
  render(<MemoryRouter><ReleaseProvider bundle={releasedBundle()}>
    <CommunityTeamsPage loadPresets={async () => { throw new Error("community unavailable"); }} />
  </ReleaseProvider></MemoryRouter>);

  expect(await screen.findByRole("alert")).toHaveTextContent("community unavailable");
  expect(screen.queryByText("没有符合筛选条件的社区配队。")).not.toBeInTheDocument();
});

test("fixture/current and orphan states are visibly non-loadable even when release IDs match", async () => {
  const fixtureChannel = preset({ channel: "fixture" });
  const orphan = preset({
    id: "team:orphan", slots: ["character:a", "character:b", "character:c", "character:missing"],
  });
  render(<MemoryRouter><ReleaseProvider bundle={releasedBundle()}>
    <CommunityTeamsPage loadPresets={async () => [fixtureChannel, orphan]} />
  </ReleaseProvider></MemoryRouter>);

  const buttons = await screen.findAllByRole("button", { name: "载入配队实验室" });
  expect(buttons).toHaveLength(2);
  expect(buttons.every((button) => button.hasAttribute("disabled"))).toBe(true);
  expect(screen.getAllByText(/版本、渠道、来源或角色引用不适用于当前资料/)).toHaveLength(2);
});

test("incompatible preset equipment is rejected before UI handoff", async () => {
  const bundle = releasedBundle();
  bundle.entities.equipment = [{
    logicalId: "light-cone:destruction", revisionId: "light-cone:destruction@release-4.3",
    validFromReleaseId: "release-4.3", validToReleaseId: null, provenance,
    kind: "light-cone", name: "毁灭测试光锥", rarity: 5,
    description: "仅用于命途不兼容回归测试。", pathRestriction: "destruction",
    superimpositionValues: [0.1], setThresholds: [], effectIds: [], reviewStatus: "reviewed",
  }];
  const memberAssumptions = structuredClone(preset().memberAssumptions);
  memberAssumptions[0] = {
    eidolon: 0,
    equipment: { status: "specified", logicalId: "light-cone:destruction", superimposition: 1 },
  };
  const incompatible = preset({ memberAssumptions });

  expect(validatePresetForBundle(incompatible, bundle).join("; ")).toMatch(/incompatible/i);
  render(<MemoryRouter><ReleaseProvider bundle={bundle}>
    <CommunityTeamsPage loadPresets={async () => [incompatible]} />
  </ReleaseProvider></MemoryRouter>);

  expect(await screen.findByRole("button", { name: "载入配队实验室" })).toBeDisabled();
});
