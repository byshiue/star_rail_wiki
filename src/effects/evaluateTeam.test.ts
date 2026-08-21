import { describe, expect, it } from "vitest";
import { evaluateTeam } from "./evaluateTeam";
import { allConditionsActive, fixtureBundle, goldenTeam } from "./__fixtures__/goldenTeams";

describe("evaluateTeam", () => {
  it("does not naively add damage bonus and vulnerability", () => {
    const result = evaluateTeam(goldenTeam, allConditionsActive, fixtureBundle);
    expect(result.groups.damage_bonus?.total).toBe(0.5);
    expect(result.groups.vulnerability?.total).toBe(0.2);
  });

  it("keeps inactive conditional effects and their evidence", () => {
    const result = evaluateTeam(goldenTeam, { enemyBroken: false }, fixtureBundle);
    const inactive = result.inactive.find(({ effectId }) => effectId === "effect:broken");
    expect(inactive).toMatchObject({ reason: "enemy_not_broken" });
    expect(inactive?.evidence.sourceRevisionId).toBeTruthy();
    expect(inactive?.evidence.provenance[0]?.sourceRevision).toBe("4f3a91c2d847beef");
  });

  it("excludes unmet triggers and unreviewed effects from active aggregation", () => {
    const result = evaluateTeam(goldenTeam, { enemyBroken: true }, fixtureBundle);
    expect(result.inactive).toEqual(expect.arrayContaining([
      expect.objectContaining({ effectId: "effect:event", reason: "event_not_triggered" }),
    ]));
    expect(result.unsupported.map(({ effectId }) => effectId)).toEqual([
      "effect:generated", "effect:unsupported",
    ]);
    expect(result.active.some(({ effectId }) => effectId === "effect:event")).toBe(false);
  });

  it("caps additive stacks and reports the discarded stacks", () => {
    const result = evaluateTeam(goldenTeam, allConditionsActive, fixtureBundle);
    const stacked = result.active.find(({ effectId }) => effectId === "effect:stacks");
    expect(stacked).toMatchObject({ value: 20, stacks: 2 });
    expect(result.groups.speed?.total).toBe(20);
    expect(result.warnings).toContainEqual(expect.objectContaining({
      effectId: "effect:stacks", code: "stack_cap_exceeded",
    }));
  });

  it("is deterministic, does not mutate inputs, and ignores condition ordering", () => {
    const buildBefore = structuredClone(goldenTeam);
    const scenarioBefore = structuredClone(allConditionsActive);
    const bundleBefore = structuredClone(fixtureBundle);
    const first = evaluateTeam(goldenTeam, allConditionsActive, fixtureBundle);
    const reordered = structuredClone(fixtureBundle);
    reordered.entities.effects.find(({ id }) => id === "effect:broken")!.conditions = [
      { type: "enemy-broken", value: true },
      { type: "custom", operator: "equals", value: "yes" },
    ];
    const scenario = { ...allConditionsActive, conditions: { custom: "yes" } };
    const a = evaluateTeam(goldenTeam, scenario, reordered);
    reordered.entities.effects.find(({ id }) => id === "effect:broken")!.conditions.reverse();
    const b = evaluateTeam(goldenTeam, scenario, reordered);

    expect(evaluateTeam(goldenTeam, allConditionsActive, fixtureBundle)).toEqual(first);
    expect(b).toEqual(a);
    expect(goldenTeam).toEqual(buildBefore);
    expect(allConditionsActive).toEqual(scenarioBefore);
    expect(fixtureBundle).toEqual(bundleBefore);
  });

  it("preserves zero and negative values without producing non-finite totals", () => {
    const bundle = structuredClone(fixtureBundle);
    bundle.entities.effects = bundle.entities.effects.map((effect) => (
      effect.id === "effect:damage" ? { ...effect, value: { base: 0, scaling: [-0.25] } } : effect
    ));
    const zero = evaluateTeam(goldenTeam, allConditionsActive, bundle);
    const negative = evaluateTeam(
      { ...goldenTeam, effectLevels: { "effect:damage": 2 } }, allConditionsActive, bundle,
    );
    expect(zero.groups.damage_bonus?.total).toBe(0);
    expect(negative.groups.damage_bonus?.total).toBe(-0.25);
    expect(Number.isFinite(negative.groups.damage_bonus?.total)).toBe(true);
  });

  it("treats a matching trigger as a fresh activation even when the old duration expired", () => {
    const result = evaluateTeam(goldenTeam, {
      triggeredEvents: ["skill-active"], remainingTurns: { "effect:event": 0 },
    }, fixtureBundle);
    expect(result.conditional).toContainEqual(expect.objectContaining({ effectId: "effect:event" }));
    expect(result.inactive).not.toContainEqual(expect.objectContaining({ effectId: "effect:event" }));
  });

  it("keeps incompatible operations separate and warns about conflicting overrides", () => {
    const bundle = structuredClone(fixtureBundle);
    const template = bundle.entities.effects.find(({ id }) => id === "effect:damage")!;
    bundle.entities.effects.push(
      { ...template, id: "effect:multiplier-a", operation: "multiplier", value: { base: 0.2, scaling: [] } },
      { ...template, id: "effect:multiplier-b", operation: "multiplier", value: { base: 0.5, scaling: [] } },
      { ...template, id: "effect:override-a", operation: "override", value: { base: 0.7, scaling: [] } },
      { ...template, id: "effect:override-b", operation: "override", value: { base: 0.8, scaling: [] } },
    );
    const result = evaluateTeam(goldenTeam, allConditionsActive, bundle);
    expect(result.groups.damage_bonus?.total).toBeNull();
    expect(result.groups.damage_bonus?.operations.percent).toBe(0.5);
    expect(result.groups.damage_bonus?.operations.multiplier).toBeCloseTo(0.8);
    expect(result.groups.damage_bonus?.operations.override).toBe(0.8);
    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: "conflicting_overrides", metric: "damage_bonus",
    }));
  });

  it("caps capped metrics and records the cap warning", () => {
    const bundle = structuredClone(fixtureBundle);
    const template = bundle.entities.effects.find(({ id }) => id === "effect:broken")!;
    bundle.entities.effects.push({
      ...template, id: "effect:critical-cap", conditions: [], value: { base: 0.95, scaling: [] },
    });
    const result = evaluateTeam(goldenTeam, allConditionsActive, bundle);
    expect(result.groups.critical_damage?.total).toBe(1.05);

    bundle.entities.effects.at(-1)!.metric = "critical_rate";
    bundle.entities.effects.push({
      ...bundle.entities.effects.at(-1)!, id: "effect:critical-rate-2", value: { base: 0.2, scaling: [] },
    });
    const capped = evaluateTeam(goldenTeam, allConditionsActive, bundle);
    expect(capped.groups.critical_rate?.total).toBe(1);
    expect(capped.warnings).toContainEqual(expect.objectContaining({
      code: "metric_cap_exceeded", metric: "critical_rate",
    }));
  });

  it("classifies unresolved targets and unconsumable buffs without aggregating them", () => {
    const bundle = structuredClone(fixtureBundle);
    const template = bundle.entities.effects.find(({ id }) => id === "effect:damage")!;
    bundle.entities.effects.push({ ...template, id: "effect:single", target: { type: "single-ally" } });
    const build = {
      ...goldenTeam,
      members: goldenTeam.members.map((member) => ({ ...member, consumableMetrics: [] })),
    };
    const result = evaluateTeam(build, allConditionsActive, bundle);
    expect(result.inactive).toContainEqual(expect.objectContaining({
      effectId: "effect:single", reason: "target_required",
    }));
    expect(result.wasted).toContainEqual(expect.objectContaining({
      effectId: "effect:damage", reason: "no_compatible_consumer",
    }));
    expect(result.groups.damage_bonus).toBeUndefined();
  });
});
