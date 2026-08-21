import { Link, useParams } from "react-router-dom";
import { useRelease } from "../app/ReleaseProvider";
import type { Effect } from "../domain/effects";
import type { FeatureRevision, RevisionIdentity } from "../domain/entities";
import type { DataRelease } from "../domain/releases";
import { EffectSourceList } from "./EffectSourceList";

function Changes({ revision, peers, kind }: { revision: RevisionIdentity; peers: RevisionIdentity[]; kind: string }) {
  const previous = peers.find((peer) => peer.logicalId === revision.logicalId && peer.revisionId !== revision.revisionId);
  return previous ? <p>变更信息：<Link to={`/wiki/${kind}/${encodeURIComponent(revision.logicalId)}?compare=${encodeURIComponent(previous.revisionId)}`}>查看前后修订</Link></p> : <p>变更信息：这是当前资料集中首个已知修订。</p>;
}

export function EntityDetailPage() {
  const { bundle } = useRelease();
  const { kind, logicalId } = useParams();
  if (!bundle) return <p>没有可浏览的版本资料。</p>;
  const decodedId = logicalId ? decodeURIComponent(logicalId) : "";
  const characterRevisions = kind === "character" ? bundle.entities.characters.filter((item) => item.logicalId === decodedId) : [];
  const character = characterRevisions[0];
  const equipmentRevisions = kind !== "character" ? bundle.entities.equipment.filter((item) => item.kind === kind && item.logicalId === decodedId) : [];
  const equipment = equipmentRevisions[0];
  const effectsFor = (revisionId: string) => bundle.entities.effects.filter((effect) => effect.sourceRevisionId === revisionId);
  if (character) return <article className="entity-detail">
    <Link to="/">← 返回资料库</Link><p className="eyebrow">角色 · {character.element} · {character.path} · {character.rarity} 星</p>
    <h1>{character.name}</h1>{characterRevisions.map((revision) => <section className="revision-card" aria-label={`修订 ${revision.revisionId}`} key={revision.revisionId}>
      <p>{revision.description}</p><EffectSourceList revision={revision} effects={[]} release={bundle.release} />
      <Changes revision={revision} peers={characterRevisions} kind="character" />
      <FeatureSection idPrefix={revision.revisionId} title="技能" features={revision.abilities} effectsFor={effectsFor} release={bundle.release} />
      <FeatureSection idPrefix={revision.revisionId} title="行迹" features={revision.traces} effectsFor={effectsFor} release={bundle.release} />
      <FeatureSection idPrefix={revision.revisionId} title="星魂" features={revision.eidolons} effectsFor={effectsFor} release={bundle.release} />
    </section>)}
  </article>;
  if (equipment) return <article className="entity-detail">
    <Link to="/">← 返回资料库</Link><p className="eyebrow">{equipment.kind === "light-cone" ? "光锥" : "遗器套装"}</p>
    <h1>{equipment.name}</h1>{equipmentRevisions.map((revision) => <section className="revision-card" aria-label={`修订 ${revision.revisionId}`} key={revision.revisionId}>
      <p>{revision.description}</p>{revision.pathRestriction && <p>命途限制：{revision.pathRestriction}</p>}
      {revision.superimpositionValues.length > 0 && <p>叠影数值：<strong>{revision.superimpositionValues.map((value) => `${Number((value * 100).toFixed(6))}%`).join(" / ")}</strong></p>}
      {revision.setThresholds.length > 0 && <p>套装档位：{revision.setThresholds.join(" / ")} 件</p>}
      <EffectSourceList revision={revision} effects={effectsFor(revision.revisionId)} release={bundle.release} />
      <Changes revision={revision} peers={equipmentRevisions} kind={revision.kind} />
    </section>)}
  </article>;
  return <section><h1>找不到资料</h1><p>此版本中不存在请求的角色或装备修订。</p><Link to="/">返回资料库</Link></section>;
}

function FeatureSection({ idPrefix, title, features, effectsFor, release }: { idPrefix: string; title: string; features: FeatureRevision[]; effectsFor: (revisionId: string) => Effect[]; release: DataRelease }) {
  return <section className="feature-section" aria-labelledby={`feature-${idPrefix}-${title}`}><h2 id={`feature-${idPrefix}-${title}`}>{title}</h2>
    {features.length === 0 ? <p>暂无已导入{title}。</p> : features.map((feature) => <article className="feature-card" key={feature.revisionId}>
      <h3>{feature.name}</h3><p className="feature-kind">{feature.kind}</p><p className="feature-text">{feature.originalText}</p>
      <EffectSourceList revision={feature} effects={effectsFor(feature.revisionId)} release={release} />
    </article>)}
  </section>;
}
