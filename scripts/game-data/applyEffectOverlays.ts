import { z } from "zod";
import { EffectSchema, type Effect } from "../../src/domain/effects";
import type { CandidateEffect } from "./extractEffects";

export const EffectOverlaySchema = EffectSchema.extend({
  reviewStatus: z.enum(["reviewed", "unsupported"]),
});
export type EffectOverlay = z.infer<typeof EffectOverlaySchema>;

export const EffectOverlayFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  overlays: z.array(EffectOverlaySchema),
});
export type EffectOverlayFile = z.infer<typeof EffectOverlayFileSchema>;

function candidateKey(candidate: CandidateEffect): string {
  return `${candidate.sourceRevisionId}\u0000${candidate.metric}\u0000${candidate.originalText}`;
}

function effectKey(effect: Effect): string {
  return `${effect.sourceRevisionId}\u0000${effect.metric}\u0000${effect.originalText}`;
}

export function applyEffectOverlays(
  candidates: readonly CandidateEffect[],
  overlays: readonly EffectOverlay[],
): Effect[] {
  const candidateCounts = new Map<string, number>();
  for (const candidate of candidates) {
    const key = candidateKey(candidate);
    candidateCounts.set(key, (candidateCounts.get(key) ?? 0) + 1);
  }

  const selected: Effect[] = [];
  for (const input of overlays) {
    const overlay = EffectOverlaySchema.parse(input);
    const key = effectKey(overlay);
    const remaining = candidateCounts.get(key) ?? 0;
    if (remaining === 0) continue;
    candidateCounts.set(key, remaining - 1);
    selected.push(overlay);
  }
  return selected.sort((left, right) => left.id.localeCompare(right.id));
}
