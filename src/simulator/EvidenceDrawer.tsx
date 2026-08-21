import { useEffect, useRef } from "react";
import type { GameReleaseBundle } from "../domain/releases";
import type { EffectEvidence } from "../effects/evaluateTeam";

type EvidenceDrawerProps = {
  evidence: EffectEvidence | null;
  bundle: GameReleaseBundle;
  onClose: () => void;
};

export function EvidenceDrawer({ evidence, bundle, onClose }: EvidenceDrawerProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!evidence) return;
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.focus();
    return () => openerRef.current?.focus();
  }, [evidence]);
  useEffect(() => {
    if (!evidence) return;
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [evidence, onClose]);

  if (!evidence) return null;
  return (
    <div className="drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <aside
        ref={dialogRef} className="evidence-drawer" role="dialog" aria-modal="true"
        aria-labelledby="evidence-title" tabIndex={-1}
      >
        <div className="section-heading">
          <div><p className="eyebrow">可核验证据</p><h2 id="evidence-title">效果证据</h2></div>
          <button type="button" onClick={onClose}>关闭</button>
        </div>
        <dl>
          <div><dt>数据版本</dt><dd>正式服 {bundle.release.gameVersion}</dd></div>
          <div><dt>效果 ID</dt><dd>{evidence.effectId}</dd></div>
          <div><dt>来源修订</dt><dd>{evidence.sourceRevisionId}</dd></div>
          <div><dt>来源逻辑 ID</dt><dd>{evidence.sourceLogicalId}</dd></div>
          <div><dt>评审状态</dt><dd>{evidence.effectReviewStatus} / {evidence.sourceReviewStatus}</dd></div>
          <div><dt>原文</dt><dd>{evidence.originalText}</dd></div>
        </dl>
        <h3>来源链接</h3>
        <ul>
          {evidence.provenance.map((source) => (
            <li key={`${source.sourceUrl}:${source.sourcePath}`}>
              <a href={source.sourceUrl} target="_blank" rel="noreferrer">{source.sourceName}</a>
              <small>{source.sourceRevision} · {source.sourcePath}</small>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}
