import { describe, expect, it } from "vitest";
import type { Effect } from "../domain/effects";
import type { GameReleaseBundle } from "../domain/releases";
import { evaluateTeam, TeamBuildValidationError } from "./evaluateTeam";
import { fixtureBundle, goldenTeam } from "./__fixtures__/goldenTeams";

function cloneBundle(): GameReleaseBundle {
  return structuredClone(fixtureBundle);
}

function sourceEffect(bundle: GameReleaseBundle, sourceRevisionId: string, id: string, value: number): Effect {
  const template = bundle.entities.effects.find((effect) => effect.id === "effect:damage")!;
  return { ...template, id, sourceRevisionId, value: { base: value, scaling: [] } };
}

function totalFor(result: ReturnType<typeof evaluateTeam>, metric: string, target: string): number | undefined {
  return result.groups.find((group) => (
    group.metric === metric && group.operation === "percent" && group.targets.join("|") === target
  ))?.total;
}

describe("evaluateTeam fix round 1", () => {
  it("selects the unique current character revision independent of array order", () => {
    const bundle = cloneBundle();
    const current = bundle.entities.characters[0]!;
    const previous = structuredClone(current);
    previous.revisionId = `${current.revisionId}:old`;
    previous.validFromReleaseId = "4.2-fixture";
    previous.validToReleaseId = bundle.release.id;
    previous.abilities[0]!.revisionId = `${current.abilities[0]!.revisionId}:old`;
    previous.abilities[0]!.validFromReleaseId = "4.2-fixture";
    previous.abilities[0]!.validToReleaseId = bundle.release.id;
    bundle.entities.characters = [previous, current];
    bundle.entities.effects.push(sourceEffect(bundle, previous.abilities[0]!.revisionId, "effect:old-character", 9));

    const result = evaluateTeam(goldenTeam, {}, bundle);
    expect(totalFor(result, "damage_bonus", "slot-1|slot-2|slot-3|slot-4")).toBe(0.5);
    expect(result.evidence.map(({ effectId }) => effectId)).not.toContain("effect:old-character");
  });

  it("selects current light-cone and relic revisions independent of array order", () => {
    const bundle = cloneBundle();
    const currentCone = bundle.entities.equipment[0]!;
    currentCone.effectIds = ["effect:current-cone"];
    const oldCone = structuredClone(currentCone);
    oldCone.revisionId = `${currentCone.revisionId}:old`;
    oldCone.validFromReleaseId = "4.2-fixture";
    oldCone.validToReleaseId = bundle.release.id;
    const currentSet = {
      ...structuredClone(currentCone), kind: "relic-set" as const,
      logicalId: "relic-set:synthetic", revisionId: "relic-set:synthetic@4.3-fixture",
      pathRestriction: null, superimpositionValues: [], setThresholds: [2], effectIds: ["effect:current-set"],
    };
    const oldSet = structuredClone(currentSet);
    oldSet.revisionId = `${currentSet.revisionId}:old`;
    oldSet.validFromReleaseId = "4.2-fixture";
    oldSet.validToReleaseId = bundle.release.id;
    bundle.entities.equipment = [oldSet, oldCone, currentSet, currentCone];
    bundle.entities.effects.push(
      sourceEffect(bundle, oldCone.revisionId, "effect:old-cone", 8),
      sourceEffect(bundle, currentCone.revisionId, "effect:current-cone", 0.3),
      sourceEffect(bundle, oldSet.revisionId, "effect:old-set", 7),
      sourceEffect(bundle, currentSet.revisionId, "effect:current-set", 0.4),
    );
    const build = structuredClone(goldenTeam);
    build.members[0]!.lightCone = { logicalId: currentCone.logicalId, superimposition: 1 };
    build.members[0]!.relicSets = [{ logicalId: currentSet.logicalId, pieces: 2 }];

    const result = evaluateTeam(build, {}, bundle);
    expect(result.evidence.map(({ effectId }) => effectId)).toEqual(expect.arrayContaining(["effect:current-cone", "effect:current-set"]));
    expect(result.evidence.map(({ effectId }) => effectId)).not.toEqual(expect.arrayContaining(["effect:old-cone", "effect:old-set"]));
  });

  it("instantiates one self effect per member slot without source revision overwrite", () => {
    const bundle = cloneBundle();
    const cone = bundle.entities.equipment[0]!;
    const self = sourceEffect(bundle, cone.revisionId, "effect:cone-self", 0.3);
    self.target = { type: "self" };
    self.stacking = { type: "additive", maxStacks: 3 };
    bundle.entities.effects.push(self);
    const build = {
      releaseId: bundle.release.id,
      members: [
        { slotId: "left", characterLogicalId: goldenTeam.members[0]!.characterLogicalId, eidolon: 0,
          lightCone: { logicalId: cone.logicalId, superimposition: 1 } },
        { slotId: "right", characterLogicalId: goldenTeam.members[0]!.characterLogicalId, eidolon: 0,
          lightCone: { logicalId: cone.logicalId, superimposition: 1 } },
      ],
    };

    const result = evaluateTeam(build, { stacks: {
      [`left:${cone.revisionId}:${self.id}`]: 1,
      [`right:${cone.revisionId}:${self.id}`]: 2,
    } }, bundle);
    const entries = result.active.filter(({ effectId }) => effectId === self.id);
    expect(entries.map(({ sourceInstanceId, targets }) => ({ sourceInstanceId, targets }))).toEqual([
      { sourceInstanceId: `left:${cone.revisionId}`, targets: ["left"] },
      { sourceInstanceId: `right:${cone.revisionId}`, targets: ["right"] },
    ]);
    expect(result.groups.filter(({ effectIds }) => effectIds.includes(self.id))).toMatchObject([
      { operation: "percent", targets: ["left"], total: 0.3 },
      { operation: "percent", targets: ["right"], total: 0.6 },
    ]);
  });

  it("groups aggregation by metric, operation, and concrete target signature", () => {
    const bundle = cloneBundle();
    const template = bundle.entities.effects.find(({ id }) => id === "effect:damage")!;
    bundle.entities.effects.push(
      { ...template, id: "effect:self-percent", target: { type: "self" }, value: { base: 0.7, scaling: [] } },
      { ...template, id: "effect:team-multiplier", operation: "multiplier", value: { base: 0.2, scaling: [] } },
    );
    const result = evaluateTeam(goldenTeam, {}, bundle);
    const summary = result.groups.map(({ metric, operation, targets, total }) => ({ metric, operation, targets, total }));
    expect(summary).toEqual(expect.arrayContaining([
      { metric: "damage_bonus", operation: "percent", targets: ["slot-1"], total: 0.7 },
      { metric: "damage_bonus", operation: "percent", targets: ["slot-1", "slot-2", "slot-3", "slot-4"], total: 0.5 },
    ]));
    const multiplier = result.groups.find(({ metric, operation }) => (
      metric === "damage_bonus" && operation === "multiplier"
    ));
    expect(multiplier?.targets).toEqual(["slot-1", "slot-2", "slot-3", "slot-4"]);
    expect(multiplier?.total).toBeCloseTo(0.2);
  });

  it("requires an explicit fresh trigger to reactivate an expired duration", () => {
    const expired = evaluateTeam(goldenTeam, {
      activeEvents: ["skill-active"], remainingTurns: { "effect:event": 0 },
    }, fixtureBundle);
    expect(expired.inactive).toContainEqual(expect.objectContaining({ effectId: "effect:event", reason: "duration_expired" }));

    const historicalOnly = evaluateTeam(goldenTeam, { activeEvents: ["skill-active"] }, fixtureBundle);
    expect(historicalOnly.inactive).toContainEqual(expect.objectContaining({
      effectId: "effect:event", reason: "event_not_triggered",
    }));

    const battleBundle = cloneBundle();
    const battleEffect = battleBundle.entities.effects.find(({ id }) => id === "effect:event")!;
    battleEffect.trigger = { type: "battle-start" };
    const battleExpired = evaluateTeam(goldenTeam, {
      battleStarted: true, remainingTurns: { "effect:event": 0 },
    }, battleBundle);
    expect(battleExpired.inactive).toContainEqual(expect.objectContaining({
      effectId: "effect:event", reason: "duration_expired",
    }));
    const battleFired = evaluateTeam(goldenTeam, {
      battleStarted: true, remainingTurns: { "effect:event": 0 },
      firedThisEvaluation: { battleStart: true },
    }, battleBundle);
    expect(battleFired.conditional).toContainEqual(expect.objectContaining({ effectId: "effect:event" }));

    const fired = evaluateTeam(goldenTeam, {
      activeEvents: ["skill-active"], remainingTurns: { "effect:event": 0 },
      firedThisEvaluation: { events: ["skill-active"] },
    }, fixtureBundle);
    expect(fired.conditional).toContainEqual(expect.objectContaining({ effectId: "effect:event" }));
  });

  it("preserves both review statuses and emits precise review exclusion reasons", () => {
    const effectGenerated = cloneBundle();
    const generated = evaluateTeam(goldenTeam, {}, effectGenerated);
    const generatedEntry = generated.unsupported.find(({ effectId }) => effectId === "effect:generated")!;
    expect(generatedEntry.reason).toBe("effect_not_reviewed");
    expect(generatedEntry.evidence).toMatchObject({ effectReviewStatus: "generated", sourceReviewStatus: "reviewed" });

    const sourceGenerated = cloneBundle();
    sourceGenerated.entities.characters[0]!.abilities[0]!.reviewStatus = "generated";
    const unreviewedSource = evaluateTeam(goldenTeam, {}, sourceGenerated).unsupported
      .find(({ effectId }) => effectId === "effect:damage")!;
    expect(unreviewedSource.reason).toBe("source_not_reviewed");
    expect(unreviewedSource.evidence).toMatchObject({ effectReviewStatus: "reviewed", sourceReviewStatus: "generated" });

    const unsupportedSource = cloneBundle();
    unsupportedSource.entities.characters[0]!.abilities[0]!.reviewStatus = "unsupported";
    expect(evaluateTeam(goldenTeam, {}, unsupportedSource).unsupported
      .find(({ effectId }) => effectId === "effect:damage")).toMatchObject({
        reason: "unsupported_source",
        evidence: { effectReviewStatus: "reviewed", sourceReviewStatus: "unsupported" },
      });
    expect(generated.unsupported.find(({ effectId }) => effectId === "effect:unsupported")).toMatchObject({
      reason: "unsupported_effect",
      evidence: { effectReviewStatus: "unsupported", sourceReviewStatus: "reviewed" },
    });
  });

  it.each([
    ["unknown character", { ...goldenTeam, members: [{ characterLogicalId: "missing", eidolon: 0 }] }],
    ["invalid eidolon", { ...goldenTeam, members: [{ ...goldenTeam.members[0]!, eidolon: 1 }] }],
    ["unknown cone", { ...goldenTeam, members: [{ ...goldenTeam.members[0]!, lightCone: { logicalId: "missing", superimposition: 1 } }] }],
    ["invalid cone rank", { ...goldenTeam, members: [{ ...goldenTeam.members[0]!, lightCone: { logicalId: "light-cone:synthetic-cone", superimposition: 6 } }] }],
    ["unknown relic", { ...goldenTeam, members: [{ ...goldenTeam.members[0]!, relicSets: [{ logicalId: "missing", pieces: 2 }] }] }],
  ])("fails fast with stable issues for %s", (_label, build) => {
    expect(() => evaluateTeam(build, {}, fixtureBundle)).toThrowError(/invalid team build:/);
  });

  it("returns deterministically ordered structured validation issues", () => {
    const build = { ...goldenTeam, members: [
      { ...goldenTeam.members[0]!, slotId: "same", lightCone: {
        logicalId: "light-cone:synthetic-cone", superimposition: 6,
      } },
      { ...goldenTeam.members[0]!, slotId: "same" },
    ] };
    expect(() => evaluateTeam(build, {}, fixtureBundle)).toThrowError(TeamBuildValidationError);
    try { evaluateTeam(build, {}, fixtureBundle); } catch (error) {
      expect((error as TeamBuildValidationError).issues.map(({ code }) => code)).toEqual(["invalid_superimposition", "duplicate_slot"]);
    }
  });
});
