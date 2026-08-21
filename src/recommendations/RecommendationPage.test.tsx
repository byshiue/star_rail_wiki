import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import communityJson from "../../data/community/teams.json";
import { ReleaseProvider } from "../app/ReleaseProvider";
import { CommunityTeamLibrarySchema } from "../domain/community";
import { fixtureBundle } from "../effects/__fixtures__/goldenTeams";
import { RecommendationPage } from "./RecommendationPage";

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
    expect(screen.getByRole("status")).toHaveTextContent(/正在加载|暂无已发布版本/);
  });
});
