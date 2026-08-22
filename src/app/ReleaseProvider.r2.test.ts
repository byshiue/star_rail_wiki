import { expect, it } from "vitest";
import entitiesJson from "../../data/fixtures/release-4.3/entities.json";
import releaseJson from "../../data/fixtures/release-4.3/release.json";
import { collectRevisionIdentities, GameReleaseBundleSchema } from "../domain/releases";
import { closeHistoricalBundle } from "./ReleaseProvider";

it("closes every historical revision at the next immutable release without changing provenance", () => {
  const bundle = GameReleaseBundleSchema.parse({ release: releaseJson, entities: entitiesJson });
  const provenance = collectRevisionIdentities(bundle.entities).map((revision) => structuredClone(revision.provenance));
  const closed = closeHistoricalBundle(bundle, "4.4-cn-2026-08-21");
  expect(collectRevisionIdentities(closed.entities).every(
    ({ validToReleaseId }) => validToReleaseId === "4.4-cn-2026-08-21",
  )).toBe(true);
  expect(collectRevisionIdentities(closed.entities).map(({ provenance: value }) => value)).toEqual(provenance);
  expect(collectRevisionIdentities(bundle.entities).every(({ validToReleaseId }) => validToReleaseId === null)).toBe(true);
});
