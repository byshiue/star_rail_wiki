import { createHash } from "node:crypto";
import { z } from "zod";
import type { FetchedSource } from "./fetchSource";

type JsonRecord = Record<string, unknown>;

function objectRecords(value: unknown): JsonRecord[] | null {
  if (Array.isArray(value)) return null;
  return Object.values(z.record(z.string(), z.record(z.string(), z.unknown())).parse(value));
}

function numberText(value: number): string {
  return Number(value.toFixed(4)).toString();
}

const parameterToken = /#(\d+)\[(i|f(\d+))\](%?)/g;
const unresolvedParameterToken = /#\d+\[[^\]]+\]/;

type ParameterContext = {
  releaseId: string; sourceRevision: string; path: string; recordId: string;
};

const sparseReleases = [
  ["4.3-cn-2026-06-10", "7b349e39ee0f6f3bf814567995829b99c95e7a93"],
  ["4.4-cn-2026-08-21", "b95e75c7e1273d819d20c530c0b7e13a3ef19fb4"],
] as const;
const reviewedSparseParameters = new Map(sparseReleases.flatMap(([releaseId, revision]) => (
  ["1140710", "1140711"].map((recordId) => [
    [releaseId, revision, "index_new/cn/character_skills.json", recordId, "5"].join("\0"),
    {
      column: 0, rows: 10, columns: 1,
      matrixSha256: "a7c25b062f1edd9bf3fcfa9ed6e64ea70174e3002d0affa14339bc956bdeda42",
    },
  ])
)));

function parameterLabel(context: ParameterContext): string {
  return `${context.path} record ${context.recordId}`;
}

function sparseParameterColumn(
  context: ParameterContext, rawIndex: string, params: number[][],
): number | undefined {
  const key = [context.releaseId, context.sourceRevision, context.path, context.recordId, rawIndex].join("\0");
  const reviewed = reviewedSparseParameters.get(key);
  if (!reviewed) return undefined;
  const matrix = JSON.stringify(params);
  const matrixSha256 = createHash("sha256").update(matrix).digest("hex");
  if (
    params.length !== reviewed.rows
    || params.some((row) => row.length !== reviewed.columns)
    || matrixSha256 !== reviewed.matrixSha256
  ) {
    throw new Error(`${parameterLabel(context)}: sparse parameter matrix does not match audited shape/hash`);
  }
  return reviewed.column;
}

function resolveParams(text: string, input: unknown, context: ParameterContext): string {
  const label = parameterLabel(context);
  if (!unresolvedParameterToken.test(text)) return text;
  const params = z.array(z.array(z.number().finite())).safeParse(input);
  if (!params.success || params.data.length === 0) {
    throw new Error(`${label}: parameter tokens require a non-empty params matrix`);
  }
  const resolved = text.replace(parameterToken, (match, rawIndex: string, format: string, rawPrecision: string | undefined, percent: string) => {
    const reviewedSparseIndex = sparseParameterColumn(context, rawIndex, params.data);
    const index = reviewedSparseIndex ?? Number(rawIndex) - 1;
    if (index < 0 || params.data.some((row) => row[index] === undefined)) {
      throw new Error(`${label}: ${match} references missing parameter column ${rawIndex}`);
    }
    const values = params.data.map((row) => row[index]!);
    const scale = percent ? 100 : 1;
    const precision = format === "i" ? null : Number(rawPrecision);
    const render = (value: number) => precision === null ? numberText(value * scale) : (value * scale).toFixed(precision);
    const first = render(values[0]!);
    const last = render(values.at(-1)!);
    return first === last ? `${first}${percent}` : `${first}${percent}→${last}${percent}`;
  });
  const unresolved = resolved.match(unresolvedParameterToken)?.[0];
  if (unresolved) throw new Error(`${label}: unsupported or unresolved parameter token ${unresolved}`);
  return resolved;
}

function propertyDescription(input: unknown): string {
  const levels = z.array(z.object({
    properties: z.array(z.object({ type: z.string(), value: z.number().finite() })).optional(),
  })).safeParse(input);
  const properties = levels.success ? levels.data.flatMap((level) => level.properties ?? []) : [];
  if (properties.length === 0) return "此节点仅提升既有技能等级；上游索引没有独立效果说明。";
  return `行迹属性：${properties.map(({ type, value }) => {
    const percent = /Ratio|Rate/.test(type);
    return `${type} +${numberText(value * (percent ? 100 : 1))}${percent ? "%" : ""}`;
  }).join("；")}`;
}

function ids(input: unknown): string[] {
  return z.array(z.union([z.string(), z.number()])).parse(input ?? []).map(String);
}

function childOwners(characters: JsonRecord[], key: "ranks" | "skills" | "skill_trees"): Map<string, string> {
  const owners = new Map<string, string>();
  for (const character of characters) {
    for (const childId of ids(character[key])) {
      if (owners.has(childId)) throw new Error(`${key} child ${childId} has multiple character owners`);
      owners.set(childId, String(character.id));
    }
  }
  return owners;
}

function normalizeChildren(
  source: FetchedSource, path: string, value: unknown, owners: Map<string, string>, kind: "rank" | "skill" | "trace",
): unknown {
  const records = objectRecords(value);
  if (!records) return value;
  return records.flatMap((record) => {
    const id = String(record.id);
    const characterId = owners.get(id);
    if (!characterId) return [];
    const rawDescription = String(record.description ?? record.desc ?? record.simple_desc ?? "");
    const description = rawDescription
      ? resolveParams(rawDescription, record.params, {
        releaseId: source.manifest.releaseId,
        sourceRevision: source.files.get(path)?.source.revision ?? "",
        path,
        recordId: id,
      })
      : propertyDescription(record.levels);
    return [{
      id,
      characterId,
      name: String(record.name || `${kind} ${id}`),
      description,
      ...(kind === "rank" ? { rank: Number(record.rank) } : { type: String(record.type_text || record.type || (kind === "trace" ? "行迹" : "技能")) }),
    }];
  });
}

export function normalizeStarRailResSource(source: FetchedSource): FetchedSource {
  const characterFile = source.files.get("index_new/cn/characters.json");
  if (!characterFile || Array.isArray(characterFile.value)) return source;
  const characters = objectRecords(characterFile.value);
  if (!characters) return source;
  const clone: FetchedSource = { ...source, files: new Map(source.files) };
  const replace = (path: string, value: unknown) => {
    const original = source.files.get(path);
    if (!original) throw new Error(`required source path is missing: ${path}`);
    clone.files.set(path, { ...original, value });
  };

  replace("index_new/cn/characters.json", characters.map((record) => ({
    id: record.id,
    name: record.name,
    rarity: record.rarity,
    element: record.element,
    path: record.path,
    description: `角色基础资料（属性：${String(record.element)}；命途：${String(record.path)}）。`,
  })));
  replace("index_new/cn/character_ranks.json", normalizeChildren(
    source, "index_new/cn/character_ranks.json", source.files.get("index_new/cn/character_ranks.json")?.value,
    childOwners(characters, "ranks"), "rank",
  ));
  replace("index_new/cn/character_skills.json", normalizeChildren(
    source, "index_new/cn/character_skills.json", source.files.get("index_new/cn/character_skills.json")?.value,
    childOwners(characters, "skills"), "skill",
  ));
  replace("index_new/cn/character_skill_trees.json", normalizeChildren(
    source, "index_new/cn/character_skill_trees.json", source.files.get("index_new/cn/character_skill_trees.json")?.value,
    childOwners(characters, "skill_trees"), "trace",
  ));

  const coneRanks = new Map((objectRecords(source.files.get("index_new/cn/light_cone_ranks.json")?.value) ?? [])
    .map((rank) => [String(rank.id), rank]));
  const cones = objectRecords(source.files.get("index_new/cn/light_cones.json")?.value);
  if (cones) replace("index_new/cn/light_cones.json", cones.map((cone) => {
    const rank = coneRanks.get(String(cone.id));
    const rankDescription = rank
      ? resolveParams(String(rank.desc ?? ""), rank.params, {
        releaseId: source.manifest.releaseId,
        sourceRevision: source.files.get("index_new/cn/light_cone_ranks.json")?.source.revision ?? "",
        path: "index_new/cn/light_cone_ranks.json",
        recordId: String(rank.id),
      })
      : "";
    return {
      id: cone.id, name: cone.name, rarity: cone.rarity, path: cone.path,
      description: `${rank?.skill ? `${String(rank.skill)}：` : ""}${rankDescription || String(cone.desc ?? "上游索引未提供光锥技能说明。")}`,
    };
  }));
  if (coneRanks.size) replace("index_new/cn/light_cone_ranks.json", [...coneRanks.values()].map((rank) => ({
    lightConeId: rank.id,
    values: z.array(z.array(z.number().finite())).parse(rank.params ?? []).flat(),
  })));

  const relics = objectRecords(source.files.get("index_new/cn/relic_sets.json")?.value);
  if (relics) replace("index_new/cn/relic_sets.json", relics.map((relic) => {
    const descriptions = Array.isArray(relic.desc) ? z.array(z.string()).parse(relic.desc) : [String(relic.desc ?? "")];
    return {
      id: relic.id, name: relic.name, rarity: null,
      description: descriptions.join("\n"),
      setThresholds: descriptions.map((_description, index) => (index + 1) * 2),
    };
  }));
  return clone;
}
