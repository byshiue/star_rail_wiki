import type { RevisionIdentity } from "../domain/entities";
import type { DataRelease, ReleaseIndex } from "../domain/releases";

const ignoredDiffFields = new Set([
  "id", "logicalId", "revisionId", "sourceRevisionId",
  "validFromReleaseId", "validToReleaseId", "provenance",
  "sourceChecksum", "checksum", "fileChecksums",
]);

export type RevisionChange = { path: string; before: unknown; after: unknown };

function releaseDepth(release: DataRelease, releases: Map<string, DataRelease>, seen = new Set<string>()): number {
  if (release.previousReleaseId === null || seen.has(release.id)) return 0;
  const previous = releases.get(release.previousReleaseId);
  if (!previous) return 0;
  seen.add(release.id);
  return releaseDepth(previous, releases, seen) + 1;
}

export function sortRevisions<T extends RevisionIdentity>(revisions: T[], index: ReleaseIndex | null): T[] {
  if (!index) return [...revisions];
  const releases = new Map(index.releases.map((release) => [release.id, release]));
  return [...revisions].sort((left, right) => {
    const leftRelease = releases.get(left.validFromReleaseId);
    const rightRelease = releases.get(right.validFromReleaseId);
    const depthDifference = (leftRelease ? releaseDepth(leftRelease, releases) : Number.MAX_SAFE_INTEGER)
      - (rightRelease ? releaseDepth(rightRelease, releases) : Number.MAX_SAFE_INTEGER);
    return depthDifference || left.revisionId.localeCompare(right.revisionId);
  });
}

export function resolveRevisionRelease(revision: RevisionIdentity, index: ReleaseIndex | null): DataRelease | undefined {
  return index?.releases.find((release) => release.id === revision.validFromReleaseId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableIdentity(value: unknown): string | null {
  if (!isRecord(value)) return null;
  if (typeof value.logicalId === "string") return value.logicalId;
  if (typeof value.id === "string") return value.id;
  return null;
}

function stableArrayMap(values: unknown[]): Map<string, unknown> | null {
  const entries = values.map((value) => [stableIdentity(value), value] as const);
  if (entries.some(([identity]) => identity === null)) return null;
  const identities = entries.map(([identity]) => identity as string);
  if (new Set(identities).size !== identities.length) return null;
  return new Map(entries as ReadonlyArray<readonly [string, unknown]>);
}

function arrayChanges(before: unknown[], after: unknown[], prefix: string): RevisionChange[] {
  const beforeByIdentity = stableArrayMap(before);
  const afterByIdentity = stableArrayMap(after);
  if (beforeByIdentity && afterByIdentity) {
    return [...new Set([...beforeByIdentity.keys(), ...afterByIdentity.keys()])].sort().flatMap((identity) => (
      collectChanges(beforeByIdentity.get(identity), afterByIdentity.get(identity), `${prefix}[${identity}]`)
    ));
  }
  return Array.from({ length: Math.max(before.length, after.length) }, (_, index) => index).flatMap((index) => (
    collectChanges(before[index], after[index], `${prefix}[${index}]`)
  ));
}

function collectChanges(before: unknown, after: unknown, prefix = ""): RevisionChange[] {
  if (Object.is(before, after) || JSON.stringify(before) === JSON.stringify(after)) return [];
  if (Array.isArray(before) || Array.isArray(after)) {
    return arrayChanges(Array.isArray(before) ? before : [], Array.isArray(after) ? after : [], prefix);
  }
  if (isRecord(before) || isRecord(after)) {
    const beforeRecord = isRecord(before) ? before : {};
    const afterRecord = isRecord(after) ? after : {};
    return [...new Set([...Object.keys(beforeRecord), ...Object.keys(afterRecord)])].sort().flatMap((key) => {
      if (ignoredDiffFields.has(key)) return [];
      return collectChanges(beforeRecord[key], afterRecord[key], prefix ? `${prefix}.${key}` : key);
    });
  }
  return [{ path: prefix || "$", before, after }];
}

export function diffRevisions(before: RevisionIdentity, after: RevisionIdentity): RevisionChange[] {
  return collectChanges(before, after);
}

export function adjacentRevision<T extends RevisionIdentity>(revisions: T[], revisionId: string, compareId: string): { before: T; after: T } | null {
  const afterIndex = revisions.findIndex((revision) => revision.revisionId === revisionId);
  if (afterIndex < 1 || revisions[afterIndex - 1]?.revisionId !== compareId) return null;
  return { before: revisions[afterIndex - 1], after: revisions[afterIndex] };
}
