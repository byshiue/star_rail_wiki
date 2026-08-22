import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import type { TargetSelector } from "../../src/domain/effects";
import { loadRoleAnnotations } from "./applyRoleAnnotations";
import {
  EffectOverlayFileSchema,
  EffectOverlaySchema,
  type EffectOverlay,
} from "./applyEffectOverlays";
import { buildRelease } from "./buildRelease";
import { collectEffectSources } from "./checkEffectCoverage";
import { extractCandidateEffects, type CandidateEffect } from "./extractEffects";
import { loadSourceManifest } from "./sourceManifest";

function unsupportedReason(text: string): string {
  if (/速度降低|减速/i.test(text)) return "不支持：速度降低的触发、目标、持续与叠加机制尚未逐项建模";
  if (/行动延后|行动提前/i.test(text)) return "不支持：行动序列变更的触发、目标、持续与重复触发机制尚未逐项建模";
  if (/抗性|穿透/i.test(text)) return "不支持：抗性或穿透效果的属性范围、目标、持续与叠加机制尚未逐项建模";
  if (/回复|恢复|治疗|生命值/i.test(text)) return "不支持：生命或资源回复的触发、目标、倍率、持续与上限机制尚未逐项建模";
  if (/持续|回合/i.test(text)) return "不支持：持续回合、刷新时点与叠加规则尚未逐项建模";
  if (/伤害|倍率/i.test(text)) return "不支持：伤害倍率的攻击类型、触发条件、目标与叠加机制尚未逐项建模";
  if (/概率|命中|抵抗/i.test(text)) return "不支持：概率、命中与抵抗判定尚未逐项建模";
  if (/层|叠加|上限/i.test(text)) return "不支持：层数、叠加、刷新与上限机制尚未逐项建模";
  return "不支持：该数值机制的触发、目标、持续与叠加规则尚未逐项建模";
}

function targetFor(text: string): TargetSelector {
  if (/敌方|敌人|enemy/i.test(text)) return { type: "all-enemies" };
  if (/我方全体|队友|team/i.test(text)) return { type: "team" };
  if (/我方单体|指定我方|single ally/i.test(text)) return { type: "single-ally" };
  return { type: "self" };
}

function generatedId(releaseId: string, candidateId: string): string {
  const digest = createHash("sha256").update(candidateId).digest("hex").slice(0, 16);
  return `effect:${releaseId}:unsupported:${digest}`;
}

export function mergeReviewedOverlays(
  releaseId: string,
  candidates: readonly CandidateEffect[],
  existing: readonly EffectOverlay[],
): EffectOverlay[] {
  const existingByCandidate = new Map(existing.map((overlay) => [overlay.candidateId, overlay]));
  const unrelated = existing.filter((overlay) => !overlay.sourceRevisionId.endsWith(`@${releaseId}`));
  const scoped = candidates.map((candidate) => {
    const previous = existingByCandidate.get(candidate.candidateId);
    if (previous?.reviewStatus === "reviewed") {
      return EffectOverlaySchema.parse({ ...previous, originalText: candidate.originalText });
    }
    return EffectOverlaySchema.parse({
      candidateId: candidate.candidateId,
      id: previous?.id ?? generatedId(releaseId, candidate.candidateId),
      sourceRevisionId: candidate.sourceRevisionId,
      metric: candidate.metric,
      operation: candidate.operation,
      value: candidate.value,
      target: candidate.target ?? targetFor(candidate.originalText),
      trigger: { type: "event", event: "unsupported-reviewed-mechanic" },
      duration: { type: "permanent" },
      stacking: { type: "none", maxStacks: 1 },
      conditions: [{ type: unsupportedReason(candidate.originalText) }],
      dispellable: null,
      reviewStatus: "unsupported",
      originalText: candidate.originalText,
    });
  });
  return [...unrelated, ...scoped].sort((left, right) => left.candidateId.localeCompare(right.candidateId));
}

function option(name: string): string {
  const index = process.argv.indexOf(name);
  const value = process.argv[index + 1];
  if (index < 0 || !value || value.startsWith("--")) throw new Error(`missing required option ${name}`);
  return value;
}

async function main(): Promise<void> {
  const manifest = await loadSourceManifest(option("--manifest"));
  const sourceRoot = option("--source-root");
  const overlayPath = option("--overlays");
  const existing = EffectOverlayFileSchema.parse(JSON.parse(await readFile(overlayPath, "utf8"))).overlays;
  const bundle = await buildRelease({
    manifest,
    sourceRoot,
    roleAnnotations: await loadRoleAnnotations(option("--roles")),
  });
  const candidates = collectEffectSources(bundle.entities).flatMap(extractCandidateEffects);
  const overlays = mergeReviewedOverlays(manifest.releaseId, candidates, existing);
  await writeFile(overlayPath, `${JSON.stringify({ schemaVersion: 1, overlays }, null, 2)}\n`);
  process.stdout.write(`${manifest.releaseId}: ${candidates.length} candidates, ${overlays.length} total overlays\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
