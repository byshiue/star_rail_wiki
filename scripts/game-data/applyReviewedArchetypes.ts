import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import type { CharacterArchetype } from "../../src/domain/entities";

const explicit4_4: Record<string, CharacterArchetype[]> = {
  "1001":["general"],"1002":["hypercarry"],"1003":["follow-up","break"],"1004":["general","hypercarry"],
  "1005":["dot"],"1006":["general","break"],"1008":["hypercarry"],"1009":["general"],"1013":["follow-up"],
  "1014":["hypercarry"],"1015":["hypercarry"],"1101":["general","hypercarry"],"1102":["hypercarry"],
  "1103":["dot"],"1104":["general"],"1105":["general"],"1106":["general"],"1107":["follow-up","counter"],
  "1108":["dot"],"1109":["hypercarry"],"1110":["general"],"1111":["dot","break"],"1112":["follow-up"],
  "1201":["hypercarry"],"1202":["general","hypercarry"],"1203":["general"],"1204":["summon","follow-up"],
  "1205":["hypercarry","counter"],"1206":["break","hypercarry"],"1207":["general"],"1208":["general"],
  "1209":["hypercarry"],"1210":["dot"],"1211":["general"],"1212":["hypercarry"],"1213":["hypercarry"],
  "1214":["break","follow-up"],"1215":["general"],"1217":["general","dot"],"1218":["dot","general"],
  "1220":["follow-up"],"1221":["follow-up","counter"],"1222":["break","follow-up"],"1223":["follow-up"],
  "1224":["follow-up","break"],"1225":["break"],"1301":["break"],"1302":["hypercarry"],
  "1303":["break","general"],"1304":["follow-up"],"1305":["follow-up"],"1306":["hypercarry","general"],
  "1307":["dot"],"1308":["hypercarry","dot"],"1309":["follow-up","general"],"1310":["break"],
  "1312":["hypercarry"],"1313":["summon","hypercarry"],"1314":["follow-up"],"1315":["break"],
  "1317":["break"],"1321":["break","general"],"1401":["follow-up","hypercarry"],"1402":["summon"],
  "1403":["general"],"1404":["hypercarry"],"1405":["hypercarry"],"1406":["general"],"1407":["summon"],
  "1408":["hypercarry"],"1409":["summon","general"],"1410":["dot"],"1412":["hypercarry","general"],
  "1413":["summon"],"1414":["general"],"1415":["general"],"1501":["hypercarry"],"1502":["follow-up","general"],
  "1504":["hypercarry"],"1505":["follow-up"],"1506":["hypercarry"],"1507":["hypercarry","counter"],
  "1508":["hypercarry"],"1509":["hypercarry"],"1510":["follow-up"],"8001":["hypercarry"],
  "8002":["hypercarry"],"8003":["general"],"8004":["general"],"8005":["break"],"8006":["break"],
  "8007":["summon"],"8008":["summon"],"8009":["general"],"8010":["general"],
};

const fixture: Record<string, CharacterArchetype[]> = {
  "synthetic-support": ["follow-up"], "synthetic-dps": ["follow-up"],
  "synthetic-sub-dps": ["dot"], "synthetic-sustain": ["general"], "synthetic-breaker": ["break"],
};

type FileShape = { schemaVersion: 1; annotations: Array<Record<string, unknown> & {
  characterLogicalId: string; releaseId: string;
}> };

export async function applyReviewedArchetypes(file = "data/manual/character-roles.json"): Promise<void> {
  const value = JSON.parse(await readFile(file, "utf8")) as FileShape;
  const seen4_4 = new Set<string>();
  value.annotations = value.annotations.map((annotation) => {
    const id = annotation.characterLogicalId.replace(/^character:/, "");
    const archetypes = fixture[id] ?? explicit4_4[id];
    if (!archetypes) throw new Error(`missing explicit archetype review for ${annotation.characterLogicalId}`);
    if (annotation.releaseId === "4.4-cn-2026-08-21") seen4_4.add(id);
    return {
      ...annotation,
      classificationOwner: "star-rail-wiki",
      archetypes,
      reviewStatus: "reviewed",
      reviewer: { name: "Star Rail Wiki maintainers", reviewedAt: "2026-08-21T20:00:00.000Z" },
    };
  });
  if (seen4_4.size !== 95) throw new Error(`expected 95 active 4.4 archetype annotations, received ${seen4_4.size}`);
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");

  for (const entitiesFile of [
    "data/fixtures/release-4.3/entities.json",
    "public/data/releases/4.3-fixture/entities.json",
    "public/data/releases/4.3-cn-2026-06-10/entities.json",
    "public/data/releases/4.4-cn-2026-08-21/entities.json",
  ]) {
    const entities = JSON.parse(await readFile(entitiesFile, "utf8")) as {
      characters: Array<{ logicalId: string; roleAnnotation: Record<string, unknown> }>;
    };
    for (const character of entities.characters) {
      const id = character.logicalId.replace(/^character:/, "");
      const archetypes = fixture[id] ?? explicit4_4[id];
      if (!archetypes) throw new Error(`missing bundle archetype review for ${character.logicalId}`);
      character.roleAnnotation = {
        ...character.roleAnnotation,
        classificationOwner: "star-rail-wiki",
        archetypes,
        reviewStatus: "reviewed",
        reviewer: { name: "Star Rail Wiki maintainers", reviewedAt: "2026-08-21T20:00:00.000Z" },
      };
    }
    await writeFile(entitiesFile, `${JSON.stringify(entities, null, 2)}\n`, "utf8");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await applyReviewedArchetypes();
