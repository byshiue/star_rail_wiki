import entitiesJson from "../../data/fixtures/release-4.3/entities.json";
import releaseJson from "../../data/fixtures/release-4.3/release.json";
import { GameReleaseBundleSchema } from "../domain/releases";
import { buildSearchIndex, searchWiki } from "./searchIndex";

test("aggregates historical revisions into one searchable logical entity", () => {
  const fixture = GameReleaseBundleSchema.parse({ release: releaseJson, entities: entitiesJson });
  const entities = structuredClone(fixture.entities);
  const previous = structuredClone(entities.equipment[0]);
  previous.revisionId = "light-cone:synthetic-cone@previous";
  previous.description = "只存在于旧修订的关键词";
  previous.validToReleaseId = fixture.release.id;
  previous.provenance[0].sourcePath = "fixtures/equipment/previous.json";
  entities.equipment.unshift(previous);
  const bundle = GameReleaseBundleSchema.parse({ release: releaseJson, entities });

  const index = buildSearchIndex(bundle);

  expect(index.documents.filter(({ id }) => id === previous.logicalId)).toHaveLength(1);
  expect(searchWiki(index, "旧修订的关键词").map(({ name }) => name)).toEqual(["测试光锥"]);
});
