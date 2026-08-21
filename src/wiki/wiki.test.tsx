import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import entitiesJson from "../../data/fixtures/release-4.3/entities.json";
import releaseJson from "../../data/fixtures/release-4.3/release.json";
import { GameReleaseBundleSchema, type GameReleaseBundle } from "../domain/releases";
import { ReleaseProvider } from "../app/ReleaseProvider";
import { EntityDetailPage } from "./EntityDetailPage";
import { WikiPage } from "./WikiPage";
import { buildSearchIndex, searchWiki } from "./searchIndex";

const fixtureBundle = GameReleaseBundleSchema.parse({ release: releaseJson, entities: entitiesJson });

function renderFixtureWiki(bundle: GameReleaseBundle = fixtureBundle) {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <ReleaseProvider bundle={bundle}>
        <Routes>
          <Route path="/" element={<WikiPage />} />
          <Route path="/wiki/:kind/:logicalId" element={<EntityDetailPage />} />
        </Routes>
      </ReleaseProvider>
    </MemoryRouter>,
  );
}

test("normalizes Chinese punctuation and filters indexed effect metrics", () => {
  const index = buildSearchIndex(fixtureBundle);

  expect(searchWiki(index, "伤害，提高", { metrics: ["damage_bonus"] }).map(({ name }) => name))
    .toEqual(["测试辅助"]);
  expect(searchWiki(index, "测试", { kinds: ["light-cone"] }).map(({ name }) => name))
    .toEqual(["测试光锥"]);
  expect(searchWiki(index, "测试", { rarities: [4] })).toEqual([]);
});

test("finds a character and shows complete skills, effects, and fixture provenance", async () => {
  const user = userEvent.setup();
  renderFixtureWiki();

  await user.type(screen.getByRole("searchbox", { name: "搜索资料" }), "测试辅助");
  await user.click(screen.getByRole("link", { name: "测试辅助" }));

  expect(screen.getByRole("heading", { name: "测试辅助" })).toBeVisible();
  expect(screen.getAllByText("测试夹具 4.3")).not.toHaveLength(0);
  expect(screen.getByText("合成评审夹具：使我方全体造成的伤害提高 10%。", { selector: ".feature-text" })).toBeVisible();
  expect(screen.getByText(/全队 · 伤害加成 · 10%/)).toBeVisible();
  expect(screen.getAllByRole("link", { name: /资料来源/ })[0]).toHaveAttribute("href", expect.stringMatching(/^https:/));
  expect(screen.getAllByText(/reviewed/)).not.toHaveLength(0);
  expect(screen.getAllByText(/fixtures\/characters\/synthetic-support\.json/)).not.toHaveLength(0);
});

test("supports keyboard filter navigation and equipment detail disclosure", async () => {
  const user = userEvent.setup();
  renderFixtureWiki();

  await user.selectOptions(screen.getByRole("combobox", { name: "资料类型" }), "light-cone");
  const result = screen.getByRole("link", { name: "测试光锥" });
  result.focus();
  await user.keyboard("{Enter}");

  expect(screen.getByRole("heading", { name: "测试光锥" })).toBeVisible();
  expect(screen.getByText(/叠影数值/)).toBeVisible();
  expect(screen.getByText("10% / 12% / 14% / 16% / 18%")).toBeVisible();
});

test("honestly reports that production has no current released bundle", async () => {
  const fetchBefore = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    currentReleaseId: null,
    releases: [releaseJson],
  }), { status: 200, headers: { "Content-Type": "application/json" } });

  try {
    render(
      <MemoryRouter>
        <ReleaseProvider><WikiPage /></ReleaseProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText("尚未导入正式版本")).toBeVisible();
    expect(screen.queryByText("正式服 4.3")).not.toBeInTheDocument();
  } finally {
    globalThis.fetch = fetchBefore;
  }
});
