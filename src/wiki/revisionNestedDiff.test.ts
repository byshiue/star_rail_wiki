import entitiesJson from "../../data/fixtures/release-4.3/entities.json";
import releaseJson from "../../data/fixtures/release-4.3/release.json";
import { GameReleaseBundleSchema } from "../domain/releases";
import { diffRevisions } from "./revisionHistory";

test("aligns nested features by logical identity and emits readable leaf changes", () => {
  const bundle = GameReleaseBundleSchema.parse({ release: releaseJson, entities: entitiesJson });
  const before = structuredClone(bundle.entities.characters[0]);
  const after = structuredClone(before);
  before.revisionId = "character:synthetic-support@before";
  before.validFromReleaseId = "4.2-fixture";
  before.validToReleaseId = "4.3-fixture";
  after.revisionId = "character:synthetic-support@after";
  after.abilities[0].revisionId = "ability:synthetic-support-skill@after";
  after.abilities[0].validFromReleaseId = "4.3-fixture";
  after.abilities[0].originalText = "更新后的技能原文。";
  after.abilities[0].provenance[0].sourceChecksum = "sha256:changed-bookkeeping";

  const changes = diffRevisions(before, after);

  expect(changes).toEqual([{
    path: "abilities[ability:synthetic-support-skill].originalText",
    before: "合成评审夹具：使我方全体造成的伤害提高 10%。",
    after: "更新后的技能原文。",
  }]);
  expect(changes.map(({ path }) => path).join(" ")).not.toMatch(/revision|valid|provenance|checksum/i);
  expect(changes.some(({ before: value, after: next }) => Array.isArray(value) || Array.isArray(next))).toBe(false);
});
