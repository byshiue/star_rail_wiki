import { expect, it } from "vitest";
import { mergeReviewedOverlays } from "./reviewResidualEffects";
import { extractCandidateEffects } from "./extractEffects";

it("turns Dan Heng's residual slow into a specifically explained unsupported overlay", () => {
  const [candidate] = extractCandidateEffects({
    revisionId: "ability:100102@4.4-cn-2026-08-21",
    originalText: "使敌方目标速度降低12%，持续2回合。",
  });

  const [overlay] = mergeReviewedOverlays("4.4-cn-2026-08-21", [candidate!], []);
  expect(overlay).toMatchObject({
    candidateId: "ability:100102@4.4-cn-2026-08-21#residual-1",
    reviewStatus: "unsupported",
    metric: "unclassified_numeric",
    target: { type: "all-enemies" },
    conditions: [{ type: expect.stringMatching(/速度降低.*触发.*持续/) }],
  });
});
