import { useEffect, useRef } from "react";
import type { GameReleaseBundle } from "../domain/releases";
import type { EffectEvidence } from "../effects/evaluateTeam";

type EvidenceDrawerProps = {
  evidence: EffectEvidence | null;
  bundle: GameReleaseBundle;
  onClose: () => void;
};

const focusableSelector = "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

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
    function handleDialogKeys(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(focusableSelector)];
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;
      const activeIndex = focusable.indexOf(active as HTMLElement);
      if (event.shiftKey && (activeIndex <= 0)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (activeIndex === -1 || active === last)) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", handleDialogKeys);
    return () => document.removeEventListener("keydown", handleDialogKeys);
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
          {evidence.maximumLevel ? <div><dt>技能等级</dt><dd>等级 {evidence.selectedLevel}（{evidence.levelSelection === "default" ? "默认" : "明确选择"}；最高 {evidence.maximumLevel}）</dd></div> : null}
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
