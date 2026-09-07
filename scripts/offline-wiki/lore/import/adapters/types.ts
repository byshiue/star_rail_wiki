import type { CanonicalLoreInput } from "../canonical";
import type { LocalLoreManifest } from "../manifest";

export type ImportRejection = Readonly<{
  sourcePath: string;
  logicalId: string | null;
  reason: "unknown-kind" | "missing-text" | "ambiguous-release" | "malformed-source";
  detail: ImportRejectionDetail;
}>;

export type ImportRejectionDetail =
  | "required-layout-missing"
  | "invalid-directory-json"
  | "release-evidence-mismatch"
  | "entry-not-declared"
  | "category-not-mapped"
  | "entry-file-not-declared"
  | "entry-read-failed"
  | "no-allowlisted-text"
  | "display-name-empty"
  | "invalid-table-json"
  | "row-kind-not-approved"
  | "story-not-found"
  | "referenced-text-missing"
  | "duplicate-entry-id"
  | "duplicate-excel-row-id"
  | "duplicate-story-id";

export type AdaptedCanonicalEntry = Readonly<{
  sourcePath: string;
  dependencyPaths: string[];
  input: CanonicalLoreInput;
}>;

export type AdapterResult = Readonly<{
  entries: AdaptedCanonicalEntry[];
  rejections: ImportRejection[];
}>;

export type AdapterInput = Readonly<{
  manifest: LocalLoreManifest;
  sourceRoot: string;
}>;

export const EMPTY_RESULT: AdapterResult = Object.freeze({ entries: [], rejections: [] });
