import { Link, useParams, useSearchParams } from "react-router-dom";
import { useRelease } from "../app/ReleaseProvider";
import type { Effect } from "../domain/effects";
import type { FeatureRevision, RevisionIdentity } from "../domain/entities";
import type { ReleaseIndex } from "../domain/releases";
import { EffectSourceList } from "./EffectSourceList";
import { RevisionComparison } from "./RevisionComparison";
import { adjacentRevision, resolveRevisionRelease, sortRevisions } from "./revisionHistory";

function Changes({ revision, peers, position, kind }: {
  revision: RevisionIdentity; peers: RevisionIdentity[]; position: number; kind: string;
}) {
  if (position === 0) return <p>变更信息：这是版本链中的首个已知修订。</p>;
  const previous = peers[position - 1];
  const search = new URLSearchParams({ revision: revision.revisionId, compare: previous.revisionId }).toString();
  return <p>变更信息：<Link to={{ search: `?${search}` }}>查看前后修订</Link>（{kind}）</p>;
}

export function EntityDetailPage() {
  const { bundle, historyBundles, index, loading, error } = useRelease();
  const { kind, logicalId } = useParams();
  const [searchParams] = useSearchParams();
  if (loading) return <p role="status">正在加载版本资料…</p>;
  if (error) return <section><h1>资料加载失败</h1><p role="alert">{error}</p></section>;
  if (!bundle) return <section><h1>尚未导入正式版本</h1><p>没有可浏览的版本资料。</p></section>;
  const decodedId = logicalId ? decodeURIComponent(logicalId) : "";
  const characterRevisions = sortRevisions(
    kind === "character" ? historyBundles.flatMap(({ entities }) => (
      entities.characters.filter((item) => item.logicalId === decodedId)
    )) : [], index,
  );
  const equipmentRevisions = sortRevisions(
    kind !== "character" ? historyBundles.flatMap(({ entities }) => (
      entities.equipment.filter((item) => item.kind === kind && item.logicalId === decodedId)
    )) : [], index,
  );
  const peers: RevisionIdentity[] = characterRevisions.length ? characterRevisions : equipmentRevisions;
  const comparison = adjacentRevision(
    peers,
    searchParams.get("revision") ?? "",
    searchParams.get("compare") ?? "",
  );
  const effectsFor = (revisionId: string) => historyBundles.flatMap(({ entities }) => (
    entities.effects.filter((effect) => effect.sourceRevisionId === revisionId)
  ));
  const character = characterRevisions[characterRevisions.length - 1];
  const equipment = equipmentRevisions[equipmentRevisions.length - 1];

  if (character) return <article className="entity-detail">
    <Link to="/">← 返回资料库</Link><p className="eyebrow">角色 · {character.element} · {character.path} · {character.rarity} 星</p>
    <h1>{character.name}</h1>
    {comparison && <RevisionComparison before={comparison.before} after={comparison.after} index={index} />}
    {characterRevisions.map((revision, position) => <section className="revision-card" aria-label={`修订 ${revision.revisionId}`} key={revision.revisionId}>
      <p>{revision.description}</p><EffectSourceList revision={revision} effects={[]} release={resolveRevisionRelease(revision, index)} />
      <Changes revision={revision} peers={characterRevisions} position={position} kind="character" />
      <FeatureSection idPrefix={revision.revisionId} title="技能" features={revision.abilities} effectsFor={effectsFor} index={index} />
      <FeatureSection idPrefix={revision.revisionId} title="行迹" features={revision.traces} effectsFor={effectsFor} index={index} />
      <FeatureSection idPrefix={revision.revisionId} title="星魂" features={revision.eidolons} effectsFor={effectsFor} index={index} />
    </section>)}
  </article>;
  if (equipment) return <article className="entity-detail">
    <Link to="/">← 返回资料库</Link><p className="eyebrow">{equipment.kind === "light-cone" ? "光锥" : "遗器套装"}</p>
    <h1>{equipment.name}</h1>
    {comparison && <RevisionComparison before={comparison.before} after={comparison.after} index={index} />}
    {equipmentRevisions.map((revision, position) => <section className="revision-card" aria-label={`修订 ${revision.revisionId}`} key={revision.revisionId}>
      <p>{revision.description}</p>{revision.pathRestriction && <p>命途限制：{revision.pathRestriction}</p>}
      {revision.superimpositionValues.length > 0 && <p>叠影数值：<strong>{revision.superimpositionValues.map((value) => `${Number((value * 100).toFixed(6))}%`).join(" / ")}</strong></p>}
      {revision.setThresholds.length > 0 && <p>套装档位：{revision.setThresholds.join(" / ")} 件</p>}
      <EffectSourceList revision={revision} effects={effectsFor(revision.revisionId)} release={resolveRevisionRelease(revision, index)} />
      <Changes revision={revision} peers={equipmentRevisions} position={position} kind={revision.kind} />
    </section>)}
  </article>;
  return <section><h1>找不到资料</h1><p>此版本中不存在请求的角色或装备修订。</p><Link to="/">返回资料库</Link></section>;
}

function FeatureSection({ idPrefix, title, features, effectsFor, index }: {
  idPrefix: string; title: string; features: FeatureRevision[];
  effectsFor: (revisionId: string) => Effect[]; index: ReleaseIndex | null;
}) {
  return <section className="feature-section" aria-labelledby={`feature-${idPrefix}-${title}`}><h2 id={`feature-${idPrefix}-${title}`}>{title}</h2>
    {features.length === 0 ? <p>暂无已导入{title}。</p> : features.map((feature) => <article className="feature-card" key={feature.revisionId}>
      <h3>{feature.name}</h3><p className="feature-kind">{feature.kind}</p><p className="feature-text">{feature.originalText}</p>
      <EffectSourceList revision={feature} effects={effectsFor(feature.revisionId)} release={resolveRevisionRelease(feature, index)} />
    </article>)}
  </section>;
}
