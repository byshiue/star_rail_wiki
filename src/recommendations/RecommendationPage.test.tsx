import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { PROFILE_SELECTION_EVENT } from "../profiles/profileSelection";
import communityJson from "../../data/community/teams.json";
import { ReleaseProvider } from "../app/ReleaseProvider";
import { CommunityTeamLibrarySchema } from "../domain/community";
import { fixtureBundle } from "../effects/__fixtures__/goldenTeams";
import { maxInvestmentFixture } from "./__fixtures__/maxInvestment";
import { RecommendationPage } from "./RecommendationPage";
import { decodeTeamBuild } from "../simulator/teamBuild";
import { createMemoryProfileDatabase } from "../profiles/profileDatabase";
import { createProfileService } from "../profiles/profileService";

const presets = CommunityTeamLibrarySchema.parse(communityJson).presets;

function renderPage(bundle = fixtureBundle) {
  return render(
    <MemoryRouter>
      <ReleaseProvider bundle={bundle}>
        <RecommendationPage loadPresets={async () => presets} />
      </ReleaseProvider>
    </MemoryRouter>,
  );
}

describe("RecommendationPage", () => {
  it("switches selected UID inventory without retaining the previous roster", async () => {
    const user = userEvent.setup();
    const service = createProfileService(createMemoryProfileDatabase());
    const characterIds = fixtureBundle.entities.characters.map(({ logicalId }) => logicalId);
    await service.putProfile({ schemaVersion: 1, uid: "100000001", label: "账号 A",
      dataReleaseId: fixtureBundle.release.id, updatedAt: "2026-08-21T00:00:00.000Z",
      characters: characterIds.slice(0, 4).map((logicalId) => ({ logicalId, eidolon: 0, level: 80 })),
      lightCones: [{ logicalId: "light-cone:synthetic-cone", superimposition: 4, level: 80 }], relics: [] });
    await service.putProfile({ schemaVersion: 1, uid: "100000002", label: "账号 B",
      dataReleaseId: fixtureBundle.release.id, updatedAt: "2026-08-21T00:00:00.000Z",
      characters: characterIds.slice(1, 5).map((logicalId) => ({ logicalId, eidolon: 2, level: 80 })),
      lightCones: [], relics: [] });
    render(<MemoryRouter><ReleaseProvider bundle={fixtureBundle}>
      <RecommendationPage loadPresets={async () => []} profileService={service} />
    </ReleaseProvider></MemoryRouter>);

    await user.selectOptions(await screen.findByLabelText("本地账号 UID"), "100000001");
    expect(screen.getByLabelText("已拥有角色 logical ID")).toHaveValue(characterIds.slice(0, 4).sort().join(", "));
    await user.click(screen.getByRole("button", { name: "生成推荐" }));
    const href = (await screen.findAllByRole("link", { name: "载入模拟器" }))[0]!.getAttribute("href")!;
    const build = decodeTeamBuild(href.split("build=")[1]!);
    expect(build.members.find(({ characterLogicalId }) => characterLogicalId === "character:synthetic-support")?.lightCone)
      .toEqual({ logicalId: "light-cone:synthetic-cone", superimposition: 4 });
    await user.selectOptions(screen.getByLabelText("本地账号 UID"), "100000002");
    expect(screen.getByLabelText("已拥有角色 logical ID")).toHaveValue(characterIds.slice(1, 5).sort().join(", "));
    expect(screen.getByRole("status")).toHaveTextContent("切换账号后已清除旧推荐");
  });

  it("clears the previous UID immediately when a profile reload fails", async () => {
    const service = createProfileService(createMemoryProfileDatabase());
    const characterIds = fixtureBundle.entities.characters.map(({ logicalId }) => logicalId);
    await service.putProfile({ schemaVersion: 1, uid: "100000001", dataReleaseId: fixtureBundle.release.id,
      updatedAt: "2026-08-21T00:00:00.000Z", characters: characterIds.slice(0, 4).map((logicalId) => ({ logicalId, eidolon: 1, level: 80 })), lightCones: [], relics: [] });
    const listProfiles = service.listProfiles.bind(service);
    let calls = 0;
    const unstable = { ...service, listProfiles: async () => { calls += 1; if (calls > 1) throw new Error("profile reload failed"); return listProfiles(); } };
    render(<MemoryRouter><ReleaseProvider bundle={fixtureBundle}>
      <RecommendationPage loadPresets={async () => []} profileService={unstable} />
    </ReleaseProvider></MemoryRouter>);
    await userEvent.selectOptions(await screen.findByLabelText("本地账号 UID"), "100000001");
    window.dispatchEvent(new CustomEvent(PROFILE_SELECTION_EVENT, { detail: "100000002" }));
    expect(await screen.findByText(/profile reload failed/)).toBeInTheDocument();
    expect(screen.getByLabelText("本地账号 UID")).toHaveValue("");
    expect(screen.getByRole("checkbox", { name: "仅使用已拥有角色" })).not.toBeChecked();
    expect(screen.getByLabelText("已拥有角色 logical ID")).toHaveValue(characterIds.slice().sort().join(", "));
  });

  it("selects owned-only roster, objective, and encounter then renders auditable candidates", async () => {
    const user = userEvent.setup();
    renderPage();

    await screen.findByRole("heading", { name: "Agent 推荐" });
    await user.click(screen.getByRole("checkbox", { name: "仅使用已拥有角色" }));
    await user.clear(screen.getByLabelText("已拥有角色 logical ID"));
    await user.type(screen.getByLabelText("已拥有角色 logical ID"), fixtureBundle.entities.characters.map((c) => c.logicalId).join(","));
    await user.selectOptions(screen.getByLabelText("推荐目标"), "comfort");
    await user.selectOptions(screen.getByLabelText("战斗场景"), "break");
    await user.click(screen.getByRole("button", { name: "生成推荐" }));

    expect(await screen.findAllByRole("article", { name: /候选队伍/ })).toHaveLength(3);
    expect(screen.getAllByText(/评分分解/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Buff 证据/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/社区参考/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: "载入模拟器" })[0]).toHaveAttribute("href", expect.stringContaining("/simulator?build="));
    expect(screen.getAllByText(/目标／场景/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/角色职责/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/优势/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/来源修订/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("link", { name: "team:synthetic-follow-up-fixture" })).not.toBeInTheDocument();
    expect(screen.getAllByText(/检索 2026-08-21/).length).toBeGreaterThan(0);
  });

  it("renders a clamped 100% activation cost for maximum valid investment", async () => {
    const user = userEvent.setup();
    const { bundle, memberBuilds } = maxInvestmentFixture();
    render(
      <MemoryRouter>
        <ReleaseProvider bundle={bundle}>
          <RecommendationPage loadPresets={async () => []} memberBuilds={memberBuilds} />
        </ReleaseProvider>
      </MemoryRouter>,
    );

    await user.click(await screen.findByRole("button", { name: "生成推荐" }));
    const [activationCost] = await screen.findAllByText("启动成本");
    expect(activationCost.parentElement).toHaveTextContent("100%（权重 -8；加权 -8）");
  });

  it("shows a structured constraint conflict rather than inventing a team", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("checkbox", { name: "仅使用已拥有角色" }));
    await user.clear(screen.getByLabelText("已拥有角色 logical ID"));
    await user.type(screen.getByLabelText("已拥有角色 logical ID"), "character:synthetic-dps,character:synthetic-support");
    await user.click(screen.getByRole("button", { name: "生成推荐" }));

    expect(screen.getByRole("alert")).toHaveTextContent("至少需要 4 名合法角色");
    expect(screen.queryByRole("article", { name: /候选队伍/ })).not.toBeInTheDocument();
  });

  it("renders an honest empty state when current release is null", () => {
    render(
      <MemoryRouter>
        <ReleaseProvider bundle={undefined} index={{ currentReleaseId: null, releases: [fixtureBundle.release] }}>
          <RecommendationPage loadPresets={async () => presets} />
        </ReleaseProvider>
      </MemoryRouter>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("暂无已发布版本");
  });
});

it("disables submission while community presets are still loading", async () => {
  let resolvePresets!: (value: typeof presets) => void;
  const pending = new Promise<typeof presets>((resolve) => { resolvePresets = resolve; });
  render(<MemoryRouter><ReleaseProvider bundle={fixtureBundle}>
    <RecommendationPage loadPresets={() => pending} />
  </ReleaseProvider></MemoryRouter>);
  const loadingButton = await screen.findByRole("button", { name: "正在加载社区参考…" });
  expect(loadingButton).toBeDisabled();
  expect(screen.queryByRole("article", { name: /候选队伍/ })).not.toBeInTheDocument();
  resolvePresets(presets);
  expect(await screen.findByRole("button", { name: "生成推荐" })).toBeEnabled();
});

it("clears old candidates and presets when a reload fails", async () => {
  const user = userEvent.setup();
  const view = render(<MemoryRouter><ReleaseProvider bundle={fixtureBundle}>
    <RecommendationPage loadPresets={async () => presets} />
  </ReleaseProvider></MemoryRouter>);
  await user.click(await screen.findByRole("button", { name: "生成推荐" }));
  expect(await screen.findAllByRole("article", { name: /候选队伍/ })).toHaveLength(3);
  view.rerender(<MemoryRouter><ReleaseProvider bundle={fixtureBundle}>
    <RecommendationPage loadPresets={async () => { throw new Error("reload failed"); }} />
  </ReleaseProvider></MemoryRouter>);
  expect(await screen.findByText(/reload failed/)).toBeInTheDocument();
  expect(screen.queryByRole("article", { name: /候选队伍/ })).not.toBeInTheDocument();
});
