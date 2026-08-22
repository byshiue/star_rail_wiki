import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, test, vi } from "vitest";
import { ReleaseProvider } from "../app/ReleaseProvider";
import type { TeamPreset } from "../domain/community";
import type { CharacterRevision } from "../domain/entities";
import type { GameReleaseBundle } from "../domain/releases";
import { TeamSimulatorPage } from "../simulator/TeamSimulatorPage";
import { CommunityTeamsPage } from "./CommunityTeamsPage";
import { createTeamBuildFromPreset, loadCommunityTeams } from "./teamRepository";

afterEach(() => vi.unstubAllGlobals());

const provenance = [{
  sourceName: "测试资料源",
  sourceUrl: "https://example.com/release-4.3",
  sourceRevision: "43acb123",
  sourcePath: "characters.json",
  sourceChecksum: "sha256:test",
}];

function releasedBundle(): GameReleaseBundle {
  const character = (logicalId: string, name: string): CharacterRevision => ({
    logicalId,
    revisionId: `${logicalId}@release-4.3`,
    validFromReleaseId: "release-4.3",
    validToReleaseId: null,
    provenance,
    name,
    rarity: 5,
    element: "虚数",
    path: "harmony",
    roleAnnotation: { characterLogicalId: logicalId, releaseId: "release-4.3", roles: ["support"], reviewStatus: "reviewed", provenance },
    description: `${name}测试资料。`,
    reviewStatus: "reviewed",
    abilities: [],
    traces: [],
    eidolons: [],
  });
  return {
    release: {
      id: "release-4.3",
      gameVersion: "4.3",
      region: "cn",
      channel: "released",
      importedAt: "2026-08-20T00:00:00.000Z",
      reviewedAt: "2026-08-21T00:00:00.000Z",
      sources: [{
        name: "测试资料源",
        url: "https://example.com/release-4.3",
        revision: "43acb123",
        fileChecksums: { "characters.json": "sha256:test" },
        retrievedAt: "2026-08-21T00:00:00.000Z",
      }],
      previousReleaseId: null,
    },
    entities: {
      characters: [
        character("character:a", "甲"),
        character("character:b", "乙"),
        character("character:c", "丙"),
        character("character:d", "丁"),
        character("character:e", "戊"),
      ],
      equipment: [],
      effects: [],
    },
  };
}

function preset(overrides: Partial<TeamPreset> = {}): TeamPreset {
  return {
    id: "team:reviewed-follow-up",
    releaseId: "release-4.3",
    gameVersion: "4.3",
    channel: "released",
    slots: ["character:a", "character:b", "character:c", "character:d"],
    memberAssumptions: [
      { eidolon: 0, equipment: { status: "none", reason: "来源未指定光锥" } },
      { eidolon: 0, equipment: { status: "none", reason: "来源未指定光锥" } },
      { eidolon: 0, equipment: { status: "none", reason: "来源未指定光锥" } },
      { eidolon: 0, equipment: { status: "none", reason: "来源未指定光锥" } },
    ],
    substitutions: [{ slot: 1, characterLogicalId: "character:e", note: "缺少乙时可换用戊。" }],
    requirements: ["全员零星魂", "不依赖限定光锥"],
    investment: "low",
    tags: ["追击", "低配"],
    summary: "项目根据来源整理的代表性追击队摘要。",
    source: {
      url: "https://example.com/community/team-guide",
      title: "4.3 Team Guide",
      author: "Guide Author",
      publisher: "Community Publisher",
      publication: { status: "published", publishedAt: "2026-08-20T00:00:00.000Z" },
      retrievedAt: "2026-08-21T00:00:00.000Z",
      availability: "available",
    },
    ...overrides,
  };
}

test("repository filters normalized presets by release and validates IDs before simulation", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
    schemaVersion: 1, libraryKind: "mixed", currentReleaseId: "release-4.3", presets: [preset()],
  }))));
  await expect(loadCommunityTeams("missing-release")).resolves.toEqual([]);
  expect(createTeamBuildFromPreset(preset(), releasedBundle())).toMatchObject({
    releaseId: "release-4.3",
    members: [
      { slotId: "slot-1", characterLogicalId: "character:a", eidolon: 0 },
      { slotId: "slot-2", characterLogicalId: "character:b", eidolon: 0 },
      { slotId: "slot-3", characterLogicalId: "character:c", eidolon: 0 },
      { slotId: "slot-4", characterLogicalId: "character:d", eidolon: 0 },
    ],
  });
  expect(() => createTeamBuildFromPreset(
    preset({ slots: ["character:a", "character:b", "character:c", "character:missing"] }),
    releasedBundle(),
  )).toThrow(/unknown character/i);
});

test("filters presets, preserves stale source attribution, and loads a valid current preset", async () => {
  const user = userEvent.setup();
  const bundle = releasedBundle();
  const stale = preset({
    id: "team:stale-break",
    releaseId: "release-4.2",
    gameVersion: "4.2",
    investment: "high",
    tags: ["击破"],
    source: {
      ...preset().source,
      url: "https://example.com/community/archived-guide",
      title: "Archived Break Guide",
      availability: "unavailable",
    },
  });
  const loader = vi.fn().mockResolvedValue([preset(), stale]);

  render(
    <MemoryRouter initialEntries={["/community"]}>
      <ReleaseProvider bundle={bundle}>
        <Routes>
          <Route path="/community" element={<CommunityTeamsPage loadPresets={loader} />} />
          <Route path="/simulator" element={<TeamSimulatorPage />} />
        </Routes>
      </ReleaseProvider>
    </MemoryRouter>,
  );

  expect(await screen.findByRole("heading", { name: "社区配队" })).toBeVisible();
  expect(screen.getByText(/Archived Break Guide/)).toBeVisible();
  expect(screen.queryByRole("link", { name: /Archived Break Guide/ })).not.toBeInTheDocument();
  expect(screen.getByText(/来源当前不可用/)).toBeVisible();
  expect(screen.getByText(/适用于 4.2.*当前资料为 4.3/)).toBeVisible();

  await user.selectOptions(screen.getByLabelText("适用版本"), "release-4.2");
  expect(screen.getByText(/Archived Break Guide/)).toBeVisible();
  expect(screen.queryByRole("heading", { name: "team:reviewed-follow-up" })).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("适用版本"), "all");

  await user.selectOptions(screen.getByLabelText("配队流派"), "追击");
  expect(screen.getByText("项目根据来源整理的代表性追击队摘要。")).toBeVisible();
  expect(screen.queryByText(/Archived Break Guide/)).not.toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText("配队流派"), "all");
  await user.type(screen.getByLabelText("包含角色"), "character:a");
  await user.selectOptions(screen.getByLabelText("投入假设"), "low");

  await user.click(screen.getByRole("button", { name: "载入配队实验室" }));
  expect(await screen.findByRole("heading", { name: "配队实验室" })).toBeVisible();
  expect(screen.getByLabelText("1号位角色")).toHaveValue("character:a");
  expect(screen.getByLabelText("4号位角色")).toHaveValue("character:d");
});

test("a null current release renders an honest empty state without loading fixture presets", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
    currentReleaseId: null,
    releases: [releasedBundle().release],
  }), { status: 200, headers: { "Content-Type": "application/json" } })));
  const loader = vi.fn().mockResolvedValue([preset()]);

  render(
    <MemoryRouter>
      <ReleaseProvider><CommunityTeamsPage loadPresets={loader} /></ReleaseProvider>
    </MemoryRouter>,
  );

  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("暂无已发布版本"));
  expect(loader).not.toHaveBeenCalled();
  expect(screen.queryByText("项目根据来源整理的代表性追击队摘要。")).not.toBeInTheDocument();
});
