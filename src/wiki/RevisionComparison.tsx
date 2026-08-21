import type { RevisionIdentity } from "../domain/entities";
import type { ReleaseIndex } from "../domain/releases";
import { diffRevisions, resolveRevisionRelease } from "./revisionHistory";

function displayValue(value: unknown): string {
  if (value === undefined) return "（无）";
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function RevisionComparison({ before, after, index }: { before: RevisionIdentity; after: RevisionIdentity; index: ReleaseIndex | null }) {
  const beforeRelease = resolveRevisionRelease(before, index);
  const afterRelease = resolveRevisionRelease(after, index);
  const changes = diffRevisions(before, after);
  return <section className="revision-comparison" aria-label="版本变化">
    <h2>版本变化</h2>
    <p>{beforeRelease?.gameVersion ?? before.validFromReleaseId} → {afterRelease?.gameVersion ?? after.validFromReleaseId}</p>
    {changes.length ? <table><thead><tr><th>字段</th><th>变更前</th><th>变更后</th></tr></thead><tbody>
      {changes.map((change) => <tr key={change.path}><th>{change.path}</th><td>{displayValue(change.before)}</td><td>{displayValue(change.after)}</td></tr>)}
    </tbody></table> : <p>可展示字段没有变化。</p>}
  </section>;
}
