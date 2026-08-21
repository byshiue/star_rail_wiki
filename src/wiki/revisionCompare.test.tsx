import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import entitiesJson from "../../data/fixtures/release-4.3/entities.json";
import releaseJson from "../../data/fixtures/release-4.3/release.json";
import { ReleaseProvider } from "../app/ReleaseProvider";
import { GameReleaseBundleSchema, ReleaseIndexSchema } from "../domain/releases";
import { EntityDetailPage } from "./EntityDetailPage";

test("resolves each revision version and compares only adjacent releases", async () => {
  const user = userEvent.setup();
  const fixture = GameReleaseBundleSchema.parse({ release: releaseJson, entities: entitiesJson });
  const entities = structuredClone(fixture.entities);
  const current = entities.equipment[0];
  current.revisionId = "light-cone:synthetic-cone@4.3";
  current.validFromReleaseId = "4.3-fixture";
  current.description = "第三版说明";
  const middle = structuredClone(current);
  middle.revisionId = "light-cone:synthetic-cone@4.2";
  middle.validFromReleaseId = "4.2-fixture";
  middle.validToReleaseId = "4.3-fixture";
  middle.description = "第二版说明";
  middle.provenance[0].sourcePath = "fixtures/equipment/4.2.json";
  const oldest = structuredClone(current);
  oldest.revisionId = "light-cone:synthetic-cone@4.1";
  oldest.validFromReleaseId = "4.1-fixture";
  oldest.validToReleaseId = "4.2-fixture";
  oldest.description = "第一版说明";
  oldest.provenance[0].sourcePath = "fixtures/equipment/4.1.json";
  entities.equipment = [current, oldest, middle];
  const bundle = GameReleaseBundleSchema.parse({ release: releaseJson, entities });
  const release43 = { ...bundle.release, previousReleaseId: "4.2-fixture" };
  const release42 = { ...release43, id: "4.2-fixture", gameVersion: "4.2", previousReleaseId: "4.1-fixture" };
  const release41 = { ...release43, id: "4.1-fixture", gameVersion: "4.1", previousReleaseId: null };
  const index = ReleaseIndexSchema.parse({ currentReleaseId: null, releases: [release43, release41, release42] });

  render(<MemoryRouter initialEntries={["/wiki/light-cone/light-cone%3Asynthetic-cone"]}>
    <ReleaseProvider bundle={bundle} index={index}><Routes>
      <Route path="/wiki/:kind/:logicalId" element={<EntityDetailPage />} />
    </Routes></ReleaseProvider>
  </MemoryRouter>);

  expect(screen.getByText("测试夹具 4.1")).toBeVisible();
  expect(screen.getByText("测试夹具 4.2")).toBeVisible();
  expect(screen.getByText("测试夹具 4.3")).toBeVisible();
  const currentRevision = screen.getByRole("region", { name: "修订 light-cone:synthetic-cone@4.3" });
  await user.click(within(currentRevision).getByRole("link", { name: "查看前后修订" }));

  const comparison = screen.getByRole("region", { name: "版本变化" });
  expect(comparison).toHaveTextContent("4.2 → 4.3");
  expect(comparison).toHaveTextContent("description");
  expect(comparison).toHaveTextContent("第二版说明");
  expect(comparison).toHaveTextContent("第三版说明");
  expect(comparison).not.toHaveTextContent("第一版说明");
});
