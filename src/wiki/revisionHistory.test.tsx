import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import entitiesJson from "../../data/fixtures/release-4.3/entities.json";
import releaseJson from "../../data/fixtures/release-4.3/release.json";
import { ReleaseProvider } from "../app/ReleaseProvider";
import { GameReleaseBundleSchema } from "../domain/releases";
import { EntityDetailPage } from "./EntityDetailPage";

test("discloses every revision and links before-after changes", () => {
  const fixtureBundle = GameReleaseBundleSchema.parse({ release: releaseJson, entities: entitiesJson });
  const entities = structuredClone(fixtureBundle.entities);
  const prior = structuredClone(entities.equipment[0]);
  prior.revisionId = "light-cone:synthetic-cone@prior";
  prior.validToReleaseId = "4.3-fixture";
  prior.description = "上一修订说明";
  prior.provenance[0].sourcePath = "fixtures/equipment/synthetic-cone-prior.json";
  entities.equipment.unshift(prior);
  const bundle = GameReleaseBundleSchema.parse({ release: releaseJson, entities });

  render(<MemoryRouter initialEntries={["/wiki/light-cone/light-cone%3Asynthetic-cone"]}>
    <ReleaseProvider bundle={bundle}><Routes>
      <Route path="/wiki/:kind/:logicalId" element={<EntityDetailPage />} />
    </Routes></ReleaseProvider>
  </MemoryRouter>);

  expect(screen.getByText("上一修订说明")).toBeVisible();
  expect(screen.getByText("仅用于自动化测试的合成装备，不代表任何真实游戏内容。")).toBeVisible();
  expect(screen.getByText(/synthetic-cone-prior\.json/)).toBeVisible();
  expect(screen.getByText(/fixtures\/equipment\/synthetic-cone\.json/)).toBeVisible();
  expect(screen.getAllByRole("link", { name: "查看前后修订" })).not.toHaveLength(0);
});
