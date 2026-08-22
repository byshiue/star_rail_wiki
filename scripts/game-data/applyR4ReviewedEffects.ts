import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { EffectOverlayFileSchema, type EffectOverlay } from "./applyEffectOverlays";
import {
  deriveReviewedSkillScaling, ReviewedSkillScalingSnapshotSchema,
} from "./reviewedSkillScaling";

const reviewed: Record<string, {
  sourceRevisionId: string; originalText: string;
  target: EffectOverlay["target"]; trigger: EffectOverlay["trigger"];
  duration: EffectOverlay["duration"]; stacking: EffectOverlay["stacking"];
}> = {
  "trace:1101103@4.4-cn-2026-08-21#effect-1": {
    sourceRevisionId: "trace:1101103@4.4-cn-2026-08-21",
    originalText: "布洛妮娅在场时，我方全体造成的伤害提高10%。",
    target: { type: "team" }, trigger: { type: "always" }, duration: { type: "permanent" },
    stacking: { type: "none", maxStacks: 1 },
  },
  "ability:110102@4.4-cn-2026-08-21#effect-1": {
    sourceRevisionId: "ability:110102@4.4-cn-2026-08-21",
    originalText: "解除指定我方单体的1个负面效果，并使该目标立即行动，造成的伤害提高33%→82.5%，持续1回合",
    target: { type: "single-ally" }, trigger: { type: "event", event: "skill:ability:110102" },
    duration: { type: "turns", value: 1 }, stacking: { type: "refresh", maxStacks: 1 },
  },
  "ability:110603@4.4-cn-2026-08-21#effect-1": {
    sourceRevisionId: "ability:110603@4.4-cn-2026-08-21",
    originalText: "【通解】状态下，敌方目标防御力降低30%→45%，持续2回合",
    target: { type: "all-enemies" }, trigger: { type: "event", event: "ultimate:ability:110603" },
    duration: { type: "turns", value: 2 }, stacking: { type: "refresh", maxStacks: 1 },
  },
};

export async function applyR4ReviewedEffects(
  file = "data/manual/effects.json",
  scalingFile = "data/releases/4.4-cn-2026-08-21/reviewed-skill-scaling.json",
): Promise<void> {
  const value = EffectOverlayFileSchema.parse(JSON.parse(await readFile(file, "utf8")));
  const scaling = ReviewedSkillScalingSnapshotSchema.parse(JSON.parse(await readFile(scalingFile, "utf8")));
  const found = new Set<string>();
  value.overlays = value.overlays.map((overlay) => {
    const review = reviewed[overlay.candidateId];
    if (!review) return overlay;
    if (overlay.sourceRevisionId !== review.sourceRevisionId || overlay.originalText !== review.originalText) {
      throw new Error(`reviewed candidate source/text drift: ${overlay.candidateId}`);
    }
    found.add(overlay.candidateId);
    const featureLogicalId = review.sourceRevisionId.split("@")[0]!;
    const reviewedValue = featureLogicalId.startsWith("ability:")
      ? deriveReviewedSkillScaling(scaling, featureLogicalId)
      : overlay.value;
    return EffectOverlayFileSchema.shape.overlays.element.parse({
      ...overlay, value: reviewedValue, target: review.target, trigger: review.trigger, duration: review.duration,
      stacking: review.stacking, conditions: [], dispellable: null, reviewStatus: "reviewed",
    });
  });
  if (found.size !== Object.keys(reviewed).length) throw new Error("not every R4 reviewed candidate exists");
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await applyR4ReviewedEffects();
