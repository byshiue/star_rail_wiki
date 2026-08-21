import type { Effect, EffectMetric, ReviewStatus, StackingRule } from "../domain/effects";
import type { CharacterRevision, EntityProvenance, EquipmentRevision, FeatureRevision, RevisionIdentity } from "../domain/entities";
import type { GameReleaseBundle } from "../domain/releases";

export interface TeamMemberBuild {
  slotId?: string;
  characterLogicalId: string;
  eidolon: number;
  lightCone?: { logicalId: string; superimposition: number };
  relicSets?: Array<{ logicalId: string; pieces: number }>;
  consumableMetrics?: EffectMetric[];
}

export interface TeamBuild {
  releaseId: string;
  members: TeamMemberBuild[];
  effectLevels?: Record<string, number>;
}

export interface FiredThisEvaluation {
  battleStart?: boolean;
  action?: boolean;
  events?: string[];
}

export interface BattleScenario {
  enemyBroken?: boolean;
  enemyWeaknesses?: string[];
  battleStarted?: boolean;
  actionActive?: boolean;
  activeEvents?: string[];
  firedThisEvaluation?: FiredThisEvaluation;
  conditions?: Record<string, string | number | boolean>;
  stacks?: Record<string, number>;
  remainingTurns?: Record<string, number>;
  remainingActions?: Record<string, number>;
  targetAssignments?: Record<string, string>;
  enemies?: string[];
}

export type EvaluationReason =
  | "source_not_selected" | "eidolon_locked" | "illegal_equipment"
  | "effect_not_reviewed" | "source_not_reviewed" | "unsupported_effect" | "unsupported_source"
  | "battle_not_started" | "action_not_active" | "event_not_triggered"
  | "duration_expired" | "target_required" | "target_not_selected"
  | "no_active_stacks" | "no_compatible_consumer"
  | "enemy_not_broken" | "condition_unknown" | "condition_not_met";

export interface EffectEvidence {
  id: string;
  effectId: string;
  effectReviewStatus: ReviewStatus;
  sourceInstanceId: string;
  sourceRevisionId: string;
  sourceLogicalId: string;
  sourceReviewStatus: ReviewStatus;
  releaseId: string;
  provenanceIds: string[];
  provenance: EntityProvenance[];
  originalText: string;
}

export interface EvaluatedEffect {
  evaluationId: string;
  effectId: string;
  sourceInstanceId: string;
  sourceRevisionId: string;
  metric: Effect["metric"];
  operation: Effect["operation"];
  stacking: StackingRule;
  value: number;
  stacks: number;
  requestedStacks: number;
  targets: string[];
  evidence: EffectEvidence;
}

export interface ExcludedEffect extends Omit<EvaluatedEffect, "value" | "stacks" | "requestedStacks" | "targets"> {
  reason: EvaluationReason | string;
  value?: number;
  stacks?: number;
  requestedStacks?: number;
  targets?: string[];
}

export interface EvaluationWarning {
  code: "stack_cap_exceeded" | "metric_cap_exceeded" | "conflicting_overrides"
    | "target_mismatch" | "no_compatible_consumer" | "scaling_level_exceeded";
  effectId?: string;
  metric?: EffectMetric;
  evaluationIds?: string[];
  requestedStacks?: number;
  stackCap?: number;
  discardedStacks?: number;
  message: string;
}

export interface AggregationGroup {
  id: string;
  metric: EffectMetric;
  operation: Effect["operation"];
  targetSignature: string;
  targets: string[];
  total: number;
  effectIds: string[];
  evaluationIds: string[];
}

export interface TeamEvaluation {
  active: EvaluatedEffect[];
  conditional: EvaluatedEffect[];
  inactive: ExcludedEffect[];
  unsupported: ExcludedEffect[];
  wasted: ExcludedEffect[];
  evidence: EffectEvidence[];
  groups: AggregationGroup[];
  warnings: EvaluationWarning[];
}

export interface TeamBuildIssue {
  code: "release_mismatch" | "invalid_member_count" | "duplicate_slot" | "unknown_character"
    | "ambiguous_character_revision" | "invalid_eidolon" | "unknown_light_cone"
    | "ambiguous_light_cone_revision" | "invalid_superimposition" | "unknown_relic_set"
    | "ambiguous_relic_revision" | "invalid_set_pieces" | "duplicate_relic_set"
    | "unknown_effect_level" | "invalid_effect_level";
  path: string;
  message: string;
}

export class TeamBuildValidationError extends Error {
  readonly issues: TeamBuildIssue[];

  constructor(issues: TeamBuildIssue[]) {
    const ordered = [...issues].sort((a, b) => `${a.path}:${a.code}`.localeCompare(`${b.path}:${b.code}`));
    super(`invalid team build: ${ordered.map(({ path, message }) => `${path}: ${message}`).join("; ")}`);
    this.name = "TeamBuildValidationError";
    this.issues = ordered;
  }
}

export interface SourceSelection {
  sourceInstanceId: string;
  memberId: string;
  revision: FeatureRevision | EquipmentRevision;
  member: TeamMemberBuild;
  legal: boolean;
  reason?: EvaluationReason;
  scalingLevel: number;
  setPieces?: number;
}

export interface EvaluationContext {
  build: TeamBuild;
  scenario: BattleScenario;
  bundle: GameReleaseBundle;
  sources: SourceSelection[];
  sourcesByRevision: Map<string, SourceSelection[]>;
  members: Map<string, TeamMemberBuild>;
  memberIds: Set<string>;
}

function activeRevision<T extends RevisionIdentity>(revisions: T[]): T | undefined {
  const active = revisions.filter(({ validToReleaseId }) => validToReleaseId === null);
  return active.length === 1 ? active[0] : undefined;
}

function selectedCharacter(
  logicalId: string, bundle: GameReleaseBundle, issues: TeamBuildIssue[], path: string,
): CharacterRevision | undefined {
  const revisions = bundle.entities.characters.filter((revision) => revision.logicalId === logicalId);
  if (revisions.length === 0) {
    issues.push({ code: "unknown_character", path, message: `unknown character ${logicalId}` });
    return undefined;
  }
  const selected = activeRevision(revisions);
  if (!selected) issues.push({
    code: "ambiguous_character_revision", path,
    message: `character ${logicalId} requires exactly one revision active for ${bundle.release.id}`,
  });
  return selected;
}

function selectedEquipment(
  kind: EquipmentRevision["kind"], logicalId: string, bundle: GameReleaseBundle,
  issues: TeamBuildIssue[], path: string,
): EquipmentRevision | undefined {
  const revisions = bundle.entities.equipment.filter((revision) => (
    revision.kind === kind && revision.logicalId === logicalId
  ));
  if (revisions.length === 0) {
    issues.push({
      code: kind === "light-cone" ? "unknown_light_cone" : "unknown_relic_set",
      path, message: `unknown ${kind} ${logicalId}`,
    });
    return undefined;
  }
  const selected = activeRevision(revisions);
  if (!selected) issues.push({
    code: kind === "light-cone" ? "ambiguous_light_cone_revision" : "ambiguous_relic_revision",
    path, message: `${kind} ${logicalId} requires exactly one revision active for ${bundle.release.id}`,
  });
  return selected;
}

function addFeatureSources(
  sources: SourceSelection[], features: FeatureRevision[], member: TeamMemberBuild,
  memberId: string, legal = true,
): void {
  for (const revision of features) sources.push({
    sourceInstanceId: `${memberId}:${revision.revisionId}`, memberId, revision, member, legal,
    reason: legal ? undefined : "eidolon_locked", scalingLevel: 1,
  });
}

function addEquipmentSource(
  sources: SourceSelection[], revision: EquipmentRevision, member: TeamMemberBuild,
  memberId: string, scalingLevel: number, legal: boolean, setPieces?: number,
): void {
  sources.push({
    sourceInstanceId: `${memberId}:${revision.revisionId}`, memberId, revision, member,
    legal, reason: legal ? undefined : "illegal_equipment", scalingLevel, setPieces,
  });
}

export function createEvaluationContext(
  build: TeamBuild, scenario: BattleScenario, bundle: GameReleaseBundle,
): EvaluationContext {
  const issues: TeamBuildIssue[] = [];
  if (build.releaseId !== bundle.release.id) issues.push({
    code: "release_mismatch", path: "releaseId",
    message: `${build.releaseId} does not match bundle ${bundle.release.id}`,
  });
  if (build.members.length < 1 || build.members.length > 4) issues.push({
    code: "invalid_member_count", path: "members", message: "team must contain between one and four members",
  });

  const sources: SourceSelection[] = [];
  const members = new Map<string, TeamMemberBuild>();
  for (const [index, member] of build.members.entries()) {
    const path = `members[${index}]`;
    const memberId = member.slotId ?? `slot-${index + 1}`;
    if (members.has(memberId)) issues.push({ code: "duplicate_slot", path: `${path}.slotId`, message: `duplicate slot ${memberId}` });
    else members.set(memberId, member);
    const character = selectedCharacter(member.characterLogicalId, bundle, issues, `${path}.characterLogicalId`);
    if (!character) continue;
    if (!Number.isInteger(member.eidolon) || member.eidolon < 0 || member.eidolon > character.eidolons.length) {
      issues.push({ code: "invalid_eidolon", path: `${path}.eidolon`, message: `eidolon must be 0..${character.eidolons.length}` });
    }
    addFeatureSources(sources, character.abilities, member, memberId);
    addFeatureSources(sources, character.traces, member, memberId);
    character.eidolons.forEach((revision, eidolonIndex) => {
      addFeatureSources(sources, [revision], member, memberId, member.eidolon >= eidolonIndex + 1);
    });

    if (member.lightCone) {
      const cone = selectedEquipment("light-cone", member.lightCone.logicalId, bundle, issues, `${path}.lightCone.logicalId`);
      if (cone) {
        const maxRank = Math.max(1, cone.superimpositionValues.length);
        if (!Number.isInteger(member.lightCone.superimposition)
          || member.lightCone.superimposition < 1 || member.lightCone.superimposition > maxRank) {
          issues.push({
            code: "invalid_superimposition", path: `${path}.lightCone.superimposition`,
            message: `superimposition must be 1..${maxRank}`,
          });
        }
        addEquipmentSource(
          sources, cone, member, memberId, member.lightCone.superimposition,
          cone.pathRestriction === null || cone.pathRestriction === character.path,
        );
      }
    }

    const seenSets = new Set<string>();
    for (const [setIndex, selectedSet] of (member.relicSets ?? []).entries()) {
      const setPath = `${path}.relicSets[${setIndex}]`;
      if (seenSets.has(selectedSet.logicalId)) issues.push({
        code: "duplicate_relic_set", path: `${setPath}.logicalId`, message: `duplicate relic set ${selectedSet.logicalId}`,
      });
      seenSets.add(selectedSet.logicalId);
      const set = selectedEquipment("relic-set", selectedSet.logicalId, bundle, issues, `${setPath}.logicalId`);
      if (!set) continue;
      if (!Number.isInteger(selectedSet.pieces) || selectedSet.pieces < 1 || selectedSet.pieces > 6) issues.push({
        code: "invalid_set_pieces", path: `${setPath}.pieces`,
        message: "pieces must be an integer from 1 to 6",
      });
      addEquipmentSource(sources, set, member, memberId, 1, true, selectedSet.pieces);
    }
  }

  for (const [effectId, level] of Object.entries(build.effectLevels ?? {})) {
    const effect = bundle.entities.effects.find(({ id }) => id === effectId);
    if (!effect) issues.push({ code: "unknown_effect_level", path: `effectLevels.${effectId}`, message: `unknown effect ${effectId}` });
    else if (!Number.isInteger(level) || level < 1 || level > effect.value.scaling.length + 1) issues.push({
      code: "invalid_effect_level", path: `effectLevels.${effectId}`,
      message: `effect level must be 1..${effect.value.scaling.length + 1}`,
    });
  }
  if (issues.length) throw new TeamBuildValidationError(issues);

  sources.sort((a, b) => a.sourceInstanceId.localeCompare(b.sourceInstanceId));
  const sourcesByRevision = new Map<string, SourceSelection[]>();
  for (const source of sources) {
    const instances = sourcesByRevision.get(source.revision.revisionId) ?? [];
    instances.push(source);
    sourcesByRevision.set(source.revision.revisionId, instances);
  }
  return { build, scenario, bundle, sources, sourcesByRevision, members, memberIds: new Set(members.keys()) };
}

export function buildEvidence(
  effect: Effect, source: SourceSelection, context: EvaluationContext,
): EffectEvidence {
  const provenance = source.revision.provenance.map((item) => ({ ...item }));
  const provenanceIds = provenance.map((item) => (
    `${item.sourceName}:${item.sourceRevision}:${item.sourcePath}:${item.sourceChecksum}`
  ));
  return {
    id: `${context.bundle.release.id}:${source.sourceInstanceId}:${effect.id}`,
    effectId: effect.id,
    effectReviewStatus: effect.reviewStatus,
    sourceInstanceId: source.sourceInstanceId,
    sourceRevisionId: effect.sourceRevisionId,
    sourceLogicalId: source.revision.logicalId,
    sourceReviewStatus: source.revision.reviewStatus,
    releaseId: context.bundle.release.id,
    provenanceIds, provenance, originalText: effect.originalText,
  };
}
