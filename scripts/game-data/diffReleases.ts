import type { GameReleaseBundle } from "../../src/domain/releases";

export interface ReleaseDiffChange {
  path: string;
  before: unknown;
  after: unknown;
}

export interface ReleaseDiffEntry {
  logicalId: string;
  kind: "added" | "removed" | "changed";
  changes: ReleaseDiffChange[];
}

type Diffable = { logicalId: string } & Record<string, unknown>;

function flatten(bundle: GameReleaseBundle): Diffable[] {
  return [
    ...bundle.entities.characters.map(({ abilities: _abilities, traces: _traces, eidolons: _eidolons, ...character }) => character),
    ...bundle.entities.characters.flatMap((character) => [
      ...character.abilities,
      ...character.traces,
      ...character.eidolons,
    ]),
    ...bundle.entities.equipment,
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function changes(before: unknown, after: unknown, prefix = ""): ReleaseDiffChange[] {
  if (Object.is(before, after)) return [];
  if (isRecord(before) && isRecord(after)) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])]
      .sort()
      .flatMap((key) => changes(before[key], after[key], prefix ? `${prefix}.${key}` : key));
  }
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  return [{ path: prefix || "$", before, after }];
}

export function diffReleases(previous: GameReleaseBundle, next: GameReleaseBundle): ReleaseDiffEntry[] {
  const before = new Map(flatten(previous).map((entity) => [entity.logicalId, entity]));
  const after = new Map(flatten(next).map((entity) => [entity.logicalId, entity]));
  return [...new Set([...before.keys(), ...after.keys()])].sort().flatMap<ReleaseDiffEntry>((logicalId) => {
    const oldEntity = before.get(logicalId);
    const newEntity = after.get(logicalId);
    if (!oldEntity) return [{ logicalId, kind: "added" as const, changes: [{ path: "$", before: undefined, after: newEntity }] }];
    if (!newEntity) return [{ logicalId, kind: "removed" as const, changes: [{ path: "$", before: oldEntity, after: undefined }] }];
    const fieldChanges = changes(oldEntity, newEntity).filter(({ path }) => path !== "logicalId");
    return fieldChanges.length ? [{ logicalId, kind: "changed" as const, changes: fieldChanges }] : [];
  });
}
