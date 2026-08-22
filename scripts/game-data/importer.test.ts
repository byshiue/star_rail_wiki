import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildRelease, writeRelease } from "./buildRelease";
import { loadRoleAnnotations } from "./applyRoleAnnotations";
import { diffReleases } from "./diffReleases";
import { loadSourceManifest } from "./sourceManifest";

const fixtureRoot = path.resolve("scripts/game-data/__fixtures__/source");
const preloadRoot = path.resolve("scripts/game-data/__fixtures__/preload-source");

describe("released game-data importer", () => {
  it("rejects a source whose text map is newer than the approved released manifest", async () => {
    const manifest = await loadSourceManifest(path.join(preloadRoot, "manifest.json"));

    await expect(buildRelease({ manifest, sourceRoot: preloadRoot })).rejects.toThrow(
      /released channel mismatch/i,
    );
  });

  it("maps every allowlisted index and records its immutable provenance", async () => {
    const manifest = await loadSourceManifest(path.join(fixtureRoot, "manifest.json"));
    const bundle = await buildRelease({ manifest, sourceRoot: fixtureRoot });

    expect(bundle.release.id).toBe("4.3-reviewed-local-fixture");
    expect(bundle.release.sources.map(({ name, revision }) => ({ name, revision }))).toEqual([
      { name: "Dimbreath evidence fixture", revision: "d5c40c00" },
      { name: "StarRailRes index fixture", revision: "93fa10b7" },
    ]);
    expect(bundle.entities.characters[0]).toMatchObject({
      name: "知更鸟",
      description: "出生于匹诺康尼，闻名银河的歌者。",
      abilities: [{ name: "扑翼白声", originalText: "使我方全体造成的伤害提高20%。" }],
      traces: [{ name: "模进乐段", originalText: "施放战技时，额外恢复5点能量。" }],
      eidolons: [{ name: "微笑的国度", originalText: "终结技期间，我方全体全属性抗性穿透提高24%。" }],
    });
    expect(bundle.entities.equipment).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          logicalId: "light-cone:23024",
          description: "使装备者的能量恢复效率提高15%。",
          superimpositionValues: [0.15, 0.175, 0.2, 0.225, 0.25],
        }),
        expect.objectContaining({
          logicalId: "relic-set:117",
          description: "2件套：攻击力提高12%。\n4件套：施放终结技时，使我方全体造成的伤害提高12%。",
          setThresholds: [2, 4],
        }),
      ]),
    );

    const revisions = [
      ...bundle.entities.characters,
      ...bundle.entities.equipment,
      ...bundle.entities.characters.flatMap((character) => [
        ...character.abilities,
        ...character.traces,
        ...character.eidolons,
      ]),
    ];
    expect(revisions.every((revision) => revision.provenance.every((p) => p.sourceChecksum))).toBe(true);
    expect(new Set(revisions.flatMap((revision) => revision.provenance.map((p) => p.sourcePath)))).toEqual(
      new Set([
        "index_new/cn/characters.json",
        "index_new/cn/character_ranks.json",
        "index_new/cn/character_skills.json",
        "index_new/cn/character_skill_trees.json",
        "index_new/cn/light_cones.json",
        "index_new/cn/light_cone_ranks.json",
        "index_new/cn/relic_sets.json",
      ]),
    );
  });

  it("writes byte-identical releases from the reviewed local source fixture", async () => {
    const manifest = await loadSourceManifest(path.join(fixtureRoot, "manifest.json"));
    const first = await mkdtemp(path.join(tmpdir(), "star-rail-release-a-"));
    const second = await mkdtemp(path.join(tmpdir(), "star-rail-release-b-"));

    await writeRelease(await buildRelease({ manifest, sourceRoot: fixtureRoot }), first);
    await writeRelease(await buildRelease({ manifest, sourceRoot: fixtureRoot }), second);

    expect(await readFile(path.join(first, "release.json"), "utf8")).toBe(
      await readFile(path.join(second, "release.json"), "utf8"),
    );
    expect(await readFile(path.join(first, "entities.json"), "utf8")).toBe(
      await readFile(path.join(second, "entities.json"), "utf8"),
    );
  });

  it("emits stable field-level changes sorted by logical id and path", async () => {
    const manifest = await loadSourceManifest(path.join(fixtureRoot, "manifest.json"));
    const previous = await buildRelease({ manifest, sourceRoot: fixtureRoot });
    const next = structuredClone(previous);
    next.entities.characters[0].description = "更新后的角色介绍。";
    next.entities.characters[0].abilities[0].originalText = "使我方全体造成的伤害提高25%。";
    next.entities.equipment = next.entities.equipment.filter((entity) => entity.kind !== "relic-set");

    expect(diffReleases(previous, next)).toEqual([
      {
        logicalId: "ability:100101",
        kind: "changed",
        changes: [{ path: "originalText", before: "使我方全体造成的伤害提高20%。", after: "使我方全体造成的伤害提高25%。" }],
      },
      {
        logicalId: "character:1001",
        kind: "changed",
        changes: [{ path: "description", before: "出生于匹诺康尼，闻名银河的歌者。", after: "更新后的角色介绍。" }],
      },
      {
        logicalId: "relic-set:117",
        kind: "removed",
        changes: [{ path: "$", before: expect.objectContaining({ name: "幽锁深牢的系囚" }), after: undefined }],
      },
    ]);
  });
});

it("keeps roles out of the upstream contract and requires exactly one reviewed annotation", async () => {
  const upstream = JSON.parse(await readFile(path.join(fixtureRoot, "index_new/cn/characters.json"), "utf8"));
  expect(upstream[0]).not.toHaveProperty("roles");
  expect(upstream[0]).not.toHaveProperty("roleAnnotation");
  const manifest = await loadSourceManifest(path.join(fixtureRoot, "manifest.json"));
  await expect(buildRelease({ manifest, sourceRoot: fixtureRoot, roleAnnotations: [] })).rejects.toThrow(/exactly one role annotation.*got 0/i);
  const annotations = await loadRoleAnnotations();
  const match = annotations.find((entry) => entry.releaseId === manifest.releaseId && entry.characterLogicalId === "character:1001")!;
  await expect(buildRelease({ manifest, sourceRoot: fixtureRoot, roleAnnotations: [...annotations, structuredClone(match)] })).rejects.toThrow(/exactly one role annotation.*got 2/i);
  const bundle = await buildRelease({ manifest, sourceRoot: fixtureRoot, roleAnnotations: annotations });
  expect(bundle.entities.characters[0].roleAnnotation).toMatchObject({
    releaseId: manifest.releaseId, roles: ["support"], reviewStatus: "reviewed",
    provenance: [expect.objectContaining({ sourcePath: "index_new/cn/characters.json" })],
  });
});
