import entitiesJson from "../../data/fixtures/release-4.3/entities.json";
import releaseJson from "../../data/fixtures/release-4.3/release.json";
import { GameReleaseBundleSchema } from "../domain/releases";
import { buildSearchIndex } from "./searchIndex";

test("keeps different equipment kinds with the same logical ID separate", () => {
  const bundle = GameReleaseBundleSchema.parse({ release: releaseJson, entities: entitiesJson });
  const relic = structuredClone(bundle.entities.equipment[0]);
  relic.kind = "relic-set";
  relic.revisionId = "relic-set:shared-logical-id@4.3";
  relic.logicalId = bundle.entities.equipment[0].logicalId;
  relic.name = "同 ID 遗器";
  relic.effectIds = [];
  bundle.entities.equipment.push(relic);

  const documents = buildSearchIndex(bundle).documents.filter(
    (document) => document.id === relic.logicalId,
  );

  expect(documents).toHaveLength(2);
  expect(documents.map(({ kind, name }) => ({ kind, name }))).toEqual([
    { kind: "light-cone", name: "测试光锥" },
    { kind: "relic-set", name: "同 ID 遗器" },
  ]);
});
