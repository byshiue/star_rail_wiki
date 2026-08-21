import { z } from "zod";
import { EffectSchema, type Effect } from "../../src/domain/effects";
import type { CandidateEffect } from "./extractEffects";

export const EffectOverlaySchema = EffectSchema.extend({
  candidateId: z.string().min(1),
  reviewStatus: z.enum(["reviewed", "unsupported"]),
});
export type EffectOverlay = z.infer<typeof EffectOverlaySchema>;

export const EffectOverlayFileSchema = z.strictObject({
  schemaVersion: z.literal(1),
  overlays: z.array(EffectOverlaySchema),
});
export type EffectOverlayFile = z.infer<typeof EffectOverlayFileSchema>;

export function applyEffectOverlays(
  candidates: readonly CandidateEffect[],
  overlays: readonly EffectOverlay[],
): Effect[] {
  const candidatesById = new Map<string, CandidateEffect>();
  for (const candidate of candidates) {
    if (candidatesById.has(candidate.candidateId)) {
      throw new Error(`duplicate candidateId: ${candidate.candidateId}`);
    }
    candidatesById.set(candidate.candidateId, candidate);
  }

  const parsedOverlays = overlays.map((overlay) => EffectOverlaySchema.parse(overlay));
  const candidateIds = new Set<string>();
  const effectIds = new Set<string>();
  for (const overlay of parsedOverlays) {
    if (candidateIds.has(overlay.candidateId)) {
      throw new Error(`duplicate overlay candidateId: ${overlay.candidateId}`);
    }
    if (effectIds.has(overlay.id)) throw new Error(`duplicate overlay effect id: ${overlay.id}`);
    candidateIds.add(overlay.candidateId);
    effectIds.add(overlay.id);
  }

  const effects = parsedOverlays.map((overlay) => {
    const candidate = candidatesById.get(overlay.candidateId);
    if (!candidate) throw new Error(`stale effect overlay candidateId: ${overlay.candidateId}`);
    if (
      overlay.sourceRevisionId !== candidate.sourceRevisionId
      || overlay.metric !== candidate.metric
      || overlay.originalText !== candidate.originalText
    ) {
      throw new Error(`effect overlay conflicts with candidateId: ${overlay.candidateId}`);
    }
    const { candidateId: _candidateId, ...effect } = overlay;
    return EffectSchema.parse(effect);
  });

  const unconsumed = candidates.find((candidate) => !candidateIds.has(candidate.candidateId));
  if (unconsumed) throw new Error(`unconsumed effect candidateId: ${unconsumed.candidateId}`);
  return effects.sort((left, right) => left.id.localeCompare(right.id));
}
