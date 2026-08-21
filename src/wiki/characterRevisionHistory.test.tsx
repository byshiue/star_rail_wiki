import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import entitiesJson from "../../data/fixtures/release-4.3/entities.json";
import releaseJson from "../../data/fixtures/release-4.3/release.json";
import { ReleaseProvider } from "../app/ReleaseProvider";
import { GameReleaseBundleSchema } from "../domain/releases";
import { EntityDetailPage } from "./EntityDetailPage";

test("discloses every top-level character revision", () => {
  const fixtureBundle = GameReleaseBundleSchema.parse({ release: releaseJson, entities: entitiesJson });
  const entities = structuredClone(fixtureBundle.entities);
  const prior = structuredClone(entities.characters[0]);
  prior.revisionId = "character:synthetic-support@prior";
  prior.validToReleaseId = "4.3-fixture";
  prior.description = "角色上一修订说明";
  prior.provenance[0].sourcePath = "fixtures/characters/synthetic-support-prior.json";
  prior.abilities = [];
  prior.traces = [];
  prior.eidolons = [];
  entities.characters.unshift(prior);
  const bundle = GameReleaseBundleSchema.parse({ release: releaseJson, entities });

  render(<MemoryRouter initialEntries={["/wiki/character/character%3Asynthetic-support"]}>
    <ReleaseProvider bundle={bundle}><Routes>
      <Route path="/wiki/:kind/:logicalId" element={<EntityDetailPage />} />
    </Routes></ReleaseProvider>
  </MemoryRouter>);

  expect(screen.getByText("角色上一修订说明")).toBeVisible();
  expect(screen.getByText("仅用于自动化测试的合成角色，不代表任何真实游戏内容。")).toBeVisible();
  expect(screen.getByText(/synthetic-support-prior\.json/)).toBeVisible();
  expect(screen.getAllByText(/fixtures\/characters\/synthetic-support\.json/)).not.toHaveLength(0);
});
