import type { ZodIssue } from "zod";
import { CommunityTeamLibrarySchema, TeamPresetSchema, type CommunityTeamLibrary } from "../src/domain/community";
import type { GameReleaseBundle, ReleaseIndex } from "../src/domain/releases";

export type ValidationIssue = {
  code: "missing_provenance" | "invalid_preset" | "unknown_release" | "release_mismatch"
    | "unknown_character" | "unknown_equipment";
  path: string;
  message: string;
};

const provenanceFields = [
  "url", "title", "author", "publisher", "publication", "retrievedAt", "availability",
] as const;

function pathOf(issue: ZodIssue): string {
  return issue.path.map(String).join(".");
}

export function validateCommunitySources(presets: readonly unknown[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  presets.forEach((preset, index) => {
    const source = typeof preset === "object" && preset !== null && "source" in preset
      ? (preset as { source?: unknown }).source
      : undefined;
    const sourceRecord = typeof source === "object" && source !== null
      ? source as Record<string, unknown>
      : {};
    const missing = provenanceFields.filter((field) => sourceRecord[field] === undefined);
    if (missing.length) issues.push({
      code: "missing_provenance", path: `presets[${index}].source`,
      message: `missing provenance fields: ${missing.join(", ")}`,
    });
    const parsed = TeamPresetSchema.safeParse(preset);
    if (!parsed.success) for (const issue of parsed.error.issues) issues.push({
      code: "invalid_preset",
      path: `presets[${index}]${pathOf(issue) ? `.${pathOf(issue)}` : ""}`,
      message: issue.message,
    });
  });
  return issues;
}

export function validateCommunityTeamLibrary(value: unknown): CommunityTeamLibrary {
  const parsed = CommunityTeamLibrarySchema.safeParse(value);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${pathOf(issue)}: ${issue.message}`).join("; ");
    throw new Error(`invalid community team library: ${details}`);
  }
  const sourceIssues = validateCommunitySources(parsed.data.presets);
  if (sourceIssues.length) throw new Error(
    `invalid community team sources: ${sourceIssues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`,
  );
  return parsed.data;
}

export function validateCommunityReferences(
  library: CommunityTeamLibrary,
  releaseIndex: ReleaseIndex,
  bundles: ReadonlyMap<string, GameReleaseBundle>,
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const releases = new Map(releaseIndex.releases.map((release) => [release.id, release]));
  for (const [presetIndex, preset] of library.presets.entries()) {
    const prefix = `presets[${presetIndex}]`;
    const release = releases.get(preset.releaseId);
    const bundle = bundles.get(preset.releaseId);
    if (!release || !bundle) {
      issues.push({ code: "unknown_release", path: `${prefix}.releaseId`, message: `unknown release ${preset.releaseId}` });
      continue;
    }
    if (release.gameVersion !== preset.gameVersion || bundle.release.gameVersion !== preset.gameVersion) issues.push({
      code: "release_mismatch", path: `${prefix}.gameVersion`,
      message: `gameVersion ${preset.gameVersion} does not match release ${release.gameVersion}`,
    });
    if (release.channel !== preset.channel || bundle.release.channel !== preset.channel) issues.push({
      code: "release_mismatch", path: `${prefix}.channel`,
      message: `channel ${preset.channel} does not match release ${release.channel}`,
    });
    const activeCharacters = new Set(bundle.entities.characters
      .filter((character) => character.validToReleaseId === null).map((character) => character.logicalId));
    preset.slots.forEach((logicalId, slot) => {
      if (!activeCharacters.has(logicalId)) issues.push({
        code: "unknown_character", path: `${prefix}.slots[${slot}]`,
        message: `unknown active character ${logicalId} in primary slot ${slot}`,
      });
    });
    preset.substitutions.forEach((substitution, index) => {
      if (!activeCharacters.has(substitution.characterLogicalId)) issues.push({
        code: "unknown_character", path: `${prefix}.substitutions[${index}].characterLogicalId`,
        message: `unknown active character ${substitution.characterLogicalId} in substitution ${index}`,
      });
    });
    const activeEquipment = new Set(bundle.entities.equipment
      .filter((equipment) => equipment.kind === "light-cone" && equipment.validToReleaseId === null)
      .map((equipment) => equipment.logicalId));
    preset.memberAssumptions.forEach((assumption, index) => {
      if (assumption.equipment.status === "specified" && !activeEquipment.has(assumption.equipment.logicalId)) {
        issues.push({
          code: "unknown_equipment", path: `${prefix}.memberAssumptions[${index}].equipment.logicalId`,
          message: `unknown active equipment ${assumption.equipment.logicalId}`,
        });
      }
    });
  }
  return issues.sort((left, right) => `${left.path}:${left.code}`.localeCompare(`${right.path}:${right.code}`));
}

export function validateCommunityRepository(
  value: unknown, releaseIndex: ReleaseIndex, bundles: ReadonlyMap<string, GameReleaseBundle>,
): CommunityTeamLibrary {
  const library = validateCommunityTeamLibrary(value);
  const issues = validateCommunityReferences(library, releaseIndex, bundles);
  if (issues.length) throw new Error(
    `invalid community repository: ${issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ")}`,
  );
  return library;
}
