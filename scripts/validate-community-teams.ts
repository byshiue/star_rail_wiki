import type { ZodIssue } from "zod";
import { CommunityTeamLibrarySchema, TeamPresetSchema, type CommunityTeamLibrary } from "../src/domain/community";

export type ValidationIssue = {
  code: "missing_provenance" | "invalid_preset";
  path: string;
  message: string;
};

const provenanceFields = [
  "url", "title", "author", "publisher", "publishedAt", "retrievedAt", "availability",
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
