import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import entitiesJson from "../../data/fixtures/release-4.3/entities.json";
import releaseJson from "../../data/fixtures/release-4.3/release.json";
import { ReleaseProvider } from "../app/ReleaseProvider";
import { GameReleaseBundleSchema } from "../domain/releases";
import { WikiPage } from "./WikiPage";

test("renders an accessible alert instead of crashing for an invalid canonical bundle", () => {
  const bundle = GameReleaseBundleSchema.parse({ release: releaseJson, entities: entitiesJson });
  const duplicate = structuredClone(bundle.entities.equipment[0]);
  duplicate.revisionId = "light-cone:synthetic-cone@duplicate-active";
  duplicate.effectIds = [];
  bundle.entities.equipment.push(duplicate);

  render(<MemoryRouter><ReleaseProvider bundle={bundle}><WikiPage /></ReleaseProvider></MemoryRouter>);

  expect(screen.getByRole("alert")).toHaveTextContent(/canonical.*active/i);
  expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
});
