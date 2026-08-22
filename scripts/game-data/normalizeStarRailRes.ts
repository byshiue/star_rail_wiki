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
const reviewedSparseParameterColumns = new Map<string, number>([
  // Upstream 4.4 keeps the original #5 token but publishes only that one value column.
  ["index_new/cn/character_skills.json record 1140710#5", 0],
  ["index_new/cn/character_skills.json record 1140711#5", 0],
]);

function resolveParams(text: string, input: unknown, context: string): string {
  if (!unresolvedParameterToken.test(text)) return text;
  const params = z.array(z.array(z.number().finite())).safeParse(input);
  if (!params.success || params.data.length === 0) {
    throw new Error(`${context}: parameter tokens require a non-empty params matrix`);
  }
  const resolved = text.replace(parameterToken, (match, rawIndex: string, format: string, rawPrecision: string | undefined, percent: string) => {
    const reviewedSparseIndex = reviewedSparseParameterColumns.get(`${context}#${rawIndex}`);
    const index = reviewedSparseIndex ?? Number(rawIndex) - 1;
    if (index < 0 || params.data.some((row) => row[index] === undefined)) {
      throw new Error(`${context}: ${match} references missing parameter column ${rawIndex}`);
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
  if (unresolved) throw new Error(`${context}: unsupported or unresolved parameter token ${unresolved}`);
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

function normalizeChildren(value: unknown, owners: Map<string, string>, kind: "rank" | "skill" | "trace"): unknown {
  const records = objectRecords(value);
  if (!records) return value;
  return records.flatMap((record) => {
    const id = String(record.id);
    const characterId = owners.get(id);
    if (!characterId) return [];
    const rawDescription = String(record.description ?? record.desc ?? record.simple_desc ?? "");
    const description = rawDescription
      ? resolveParams(rawDescription, record.params, `index_new/cn/character_${kind === "rank" ? "ranks" : kind === "skill" ? "skills" : "skill_trees"}.json record ${id}`)
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
    source.files.get("index_new/cn/character_ranks.json")?.value, childOwners(characters, "ranks"), "rank",
  ));
  replace("index_new/cn/character_skills.json", normalizeChildren(
    source.files.get("index_new/cn/character_skills.json")?.value, childOwners(characters, "skills"), "skill",
  ));
  replace("index_new/cn/character_skill_trees.json", normalizeChildren(
    source.files.get("index_new/cn/character_skill_trees.json")?.value, childOwners(characters, "skill_trees"), "trace",
  ));

  const coneRanks = new Map((objectRecords(source.files.get("index_new/cn/light_cone_ranks.json")?.value) ?? [])
    .map((rank) => [String(rank.id), rank]));
  const cones = objectRecords(source.files.get("index_new/cn/light_cones.json")?.value);
  if (cones) replace("index_new/cn/light_cones.json", cones.map((cone) => {
    const rank = coneRanks.get(String(cone.id));
    const rankDescription = rank
      ? resolveParams(String(rank.desc ?? ""), rank.params, `index_new/cn/light_cone_ranks.json record ${String(rank.id)}`)
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
