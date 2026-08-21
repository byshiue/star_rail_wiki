import entitiesJson from "../../data/fixtures/release-4.3/entities.json";
import releaseJson from "../../data/fixtures/release-4.3/release.json";
import { GameReleaseBundleSchema } from "../domain/releases";
import { buildSearchIndex, searchWiki } from "./searchIndex";

function historyBundle(activeCount: 0 | 1 | 2) {
  const fixture = GameReleaseBundleSchema.parse({ release: releaseJson, entities: entitiesJson });
  const entities = structuredClone(fixture.entities);
  const current = entities.equipment[0];
  current.description = "当前规范说明";
  current.validToReleaseId = activeCount === 0 ? "4.4-fixture" : null;
  const previous = structuredClone(current);
  previous.revisionId = "light-cone:synthetic-cone@previous";
  previous.description = "旧修订独有关键词";
  previous.validFromReleaseId = "4.2-fixture";
  previous.validToReleaseId = activeCount === 2 ? null : "4.3-fixture";
  previous.provenance[0].sourcePath = "fixtures/equipment/previous.json";
  entities.equipment = [current, previous];
  return GameReleaseBundleSchema.parse({ release: releaseJson, entities });
}

test("selects the single active canonical revision regardless of input order", () => {
  const bundle = historyBundle(1);

  const result = searchWiki(buildSearchIndex(bundle), "旧修订独有关键词");

  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({ name: "测试光锥", description: "当前规范说明" });
});

test.each([0, 2] as const)("rejects an unsafe canonical set with %s active revisions", (activeCount) => {
  expect(() => buildSearchIndex(historyBundle(activeCount))).toThrow(/canonical.*active/i);
});
