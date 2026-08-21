import type { RevisionIdentity } from "../domain/entities";
import type { DataRelease, ReleaseIndex } from "../domain/releases";

const ignoredDiffFields = new Set([
  "logicalId", "revisionId", "validFromReleaseId", "validToReleaseId", "provenance",
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

function collectChanges(before: unknown, after: unknown, prefix = ""): RevisionChange[] {
  if (Object.is(before, after) || JSON.stringify(before) === JSON.stringify(after)) return [];
  if (isRecord(before) && isRecord(after)) {
    return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort().flatMap((key) => {
      if (!prefix && ignoredDiffFields.has(key)) return [];
      return collectChanges(before[key], after[key], prefix ? `${prefix}.${key}` : key);
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
