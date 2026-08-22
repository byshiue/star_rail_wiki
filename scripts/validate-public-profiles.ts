import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { ZodIssue } from "zod";
import { GameReleaseBundleSchema, ReleaseEntitiesSchema, ReleaseIndexSchema, type GameReleaseBundle, type ReleaseIndex } from "../src/domain/releases";
import { isConsentTimestampTooFarInFuture, PublicAccountProfileSchema, PublicProfileIndexSchema, PUBLIC_PROFILE_INDEX_SCHEMA_VERSION } from "../src/profiles/publication";

export type PublicProfileIssueCode = "invalid_path" | "uid_path_mismatch" | "invalid_profile" | "unexpected_field" | "secret" | "future_consent" | "unknown_release" | "unreleased_release" | "unknown_character" | "unknown_equipment" | "duplicate_reference" | "file_too_large" | "unsupported_index_version" | "invalid_index" | "duplicate_uid" | "missing_profile_file" | "unindexed_profile_file" | "index_reference_mismatch";
export type PublicProfileValidationIssue = { code: PublicProfileIssueCode; path: string; message: string };
export type PublicProfileReferenceContext = { releaseIndex: ReleaseIndex; bundles: ReadonlyMap<string, GameReleaseBundle> };

const MAX_BYTES = 1024 * 1024;
const profilePathPattern = /^public\/profiles\/(\d{9})\.json$/;
const secretKey = /(?:token|secret|password|passwd|cookie|authorization|api[_-]?key|private[_-]?key)/i;
const secretValue = /(?:gh[pousr]_[A-Za-z0-9_]{8,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|Bearer\s+\S+)/i;
const issue = (code: PublicProfileIssueCode, issuePath: string, message: string): PublicProfileValidationIssue => ({ code, path: issuePath, message });
const zodPath = (value: ZodIssue) => value.path.map(String).join(".");

function scanSecrets(value: unknown, currentPath = ""): PublicProfileValidationIssue[] {
  if (typeof value === "string") return secretValue.test(value) ? [issue("secret", currentPath, "credential-like value is forbidden")] : [];
  if (Array.isArray(value)) return value.flatMap((item, index) => scanSecrets(item, `${currentPath}[${index}]`));
  if (typeof value !== "object" || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => { const childPath = currentPath ? `${currentPath}.${key}` : key; return [...(secretKey.test(key) ? [issue("secret", childPath, "credential-like field is forbidden")] : []), ...scanSecrets(child, childPath)]; });
}

export function validatePublicProfileFile(file: string, value: unknown, context?: PublicProfileReferenceContext, byteLength = Buffer.byteLength(JSON.stringify(value)), nowMs = Date.now()): PublicProfileValidationIssue[] {
  const issues: PublicProfileValidationIssue[] = [];
  const match = profilePathPattern.exec(file);
  if (!match) issues.push(issue("invalid_path", file, "profile path must be public/profiles/<9-digit-uid>.json"));
  if (byteLength > MAX_BYTES) issues.push(issue("file_too_large", file, "public profile exceeds 1 MiB"));
  issues.push(...scanSecrets(value));
  const parsed = PublicAccountProfileSchema.safeParse(value);
  if (!parsed.success) {
    for (const detail of parsed.error.issues) issues.push(issue(detail.code === "unrecognized_keys" ? "unexpected_field" : "invalid_profile", zodPath(detail), detail.message));
    return issues;
  }
  const profile = parsed.data;
  if (isConsentTimestampTooFarInFuture(profile.publication.consentedAt, nowMs)) issues.push(issue("future_consent", "publication.consentedAt", "publication consent cannot be more than five minutes in the future"));
  if (match && match[1] !== profile.uid) issues.push(issue("uid_path_mismatch", file, `path UID ${match[1]} does not match body UID ${profile.uid}`));
  for (const [field, ids] of [["characters", profile.characters.map((item) => item.logicalId)], ["lightCones", profile.lightCones.map((item) => item.logicalId)]] as const) {
    const seen = new Set<string>(); ids.forEach((id, index) => { if (seen.has(id)) issues.push(issue("duplicate_reference", `${field}[${index}]`, `duplicate ${field} ID ${id}`)); seen.add(id); });
  }
  if (!context) return issues;
  const release = context.releaseIndex.releases.find(({ id }) => id === profile.releaseId); const bundle = context.bundles.get(profile.releaseId);
  if (!release || !bundle) { issues.push(issue("unknown_release", "releaseId", `unknown release ${profile.releaseId}`)); return issues; }
  if (release.channel !== "released") issues.push(issue("unreleased_release", "releaseId", `release ${profile.releaseId} is not released`));
  const characters = new Set(bundle.entities.characters.filter((item) => item.validToReleaseId === null).map((item) => item.logicalId));
  const equipment = new Map(bundle.entities.equipment.filter((item) => item.validToReleaseId === null).map((item) => [item.logicalId, item.kind]));
  profile.characters.forEach((item, index) => { if (!characters.has(item.logicalId)) issues.push(issue("unknown_character", `characters[${index}].logicalId`, `unknown active character ${item.logicalId}`)); });
  profile.lightCones.forEach((item, index) => { if (equipment.get(item.logicalId) !== "light-cone") issues.push(issue("unknown_equipment", `lightCones[${index}].logicalId`, `unknown active light cone ${item.logicalId}`)); });
  profile.relics.forEach((item, index) => { if (equipment.get(item.setLogicalId) !== "relic-set") issues.push(issue("unknown_equipment", `relics[${index}].setLogicalId`, `unknown active relic set ${item.setLogicalId}`)); });
  return issues;
}

export function validatePublicProfileIndex(value: unknown, files: ReadonlyMap<string, unknown>): PublicProfileValidationIssue[] {
  const issues: PublicProfileValidationIssue[] = []; const record = typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
  issues.push(...scanSecrets(value));
  const parsed = PublicProfileIndexSchema.safeParse(value);
  if (!parsed.success) for (const detail of parsed.error.issues) {
    issues.push(issue("invalid_index", zodPath(detail), detail.message));
  }
  if (record.schemaVersion !== PUBLIC_PROFILE_INDEX_SCHEMA_VERSION) issues.push(issue("unsupported_index_version", "schemaVersion", `index schemaVersion must be ${PUBLIC_PROFILE_INDEX_SCHEMA_VERSION}`));
  const entries = Array.isArray(record.profiles) ? record.profiles : [];
  if (!Array.isArray(record.profiles)) issues.push(issue("invalid_index", "profiles", "profiles must be an array"));
  const seen = new Set<string>(); const indexedPaths = new Set<string>();
  for (const [index, raw] of entries.entries()) {
    if (typeof raw !== "object" || raw === null) { issues.push(issue("invalid_index", `profiles[${index}]`, "entry must be an object")); continue; }
    const entry = raw as Record<string, unknown>; const uid = typeof entry.uid === "string" ? entry.uid : ""; const relativePath = typeof entry.path === "string" ? entry.path : "";
    if (!/^\d{9}$/.test(uid) || relativePath !== `${uid}.json` || typeof entry.updatedAt !== "string" || Number.isNaN(Date.parse(entry.updatedAt))) issues.push(issue("invalid_index", `profiles[${index}]`, "invalid index entry"));
    if (seen.has(uid)) issues.push(issue("duplicate_uid", `profiles[${index}].uid`, `duplicate indexed UID ${uid}`)); seen.add(uid);
    const fullPath = `public/profiles/${relativePath}`; indexedPaths.add(fullPath); const file = files.get(fullPath);
    if (file === undefined) issues.push(issue("missing_profile_file", fullPath, "indexed profile file is missing"));
    else { const parsed = PublicAccountProfileSchema.safeParse(file); if (parsed.success && (parsed.data.uid !== uid || parsed.data.updatedAt !== entry.updatedAt)) issues.push(issue("index_reference_mismatch", `profiles[${index}]`, "index entry does not match profile body")); }
  }
  for (const file of files.keys()) if (profilePathPattern.test(file) && !indexedPaths.has(file)) issues.push(issue("unindexed_profile_file", file, "profile file is not listed in index.json"));
  return issues;
}

async function readJson(file: string): Promise<unknown> { return JSON.parse(await readFile(file, "utf8")); }
export async function validatePublicProfileRepository(repositoryRoot = "."): Promise<void> {
  const releaseRoot = path.join(repositoryRoot, "public/data/releases"); const releaseIndex = ReleaseIndexSchema.parse(await readJson(path.join(releaseRoot, "index.json"))); const bundles = new Map<string, GameReleaseBundle>();
  for (const release of releaseIndex.releases) bundles.set(release.id, GameReleaseBundleSchema.parse({ release: await readJson(path.join(releaseRoot, release.id, "release.json")), entities: ReleaseEntitiesSchema.parse(await readJson(path.join(releaseRoot, release.id, "entities.json"))) }));
  const root = path.join(repositoryRoot, "public/profiles"); const files = new Map<string, unknown>(); const issues: PublicProfileValidationIssue[] = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.name === "index.json" || entry.name === ".gitkeep") continue; const relative = `public/profiles/${entry.name}`;
    if (!entry.isFile() || !/^\d{9}\.json$/.test(entry.name)) { issues.push(issue("invalid_path", relative, "only exact UID JSON files are allowed")); continue; }
    const absolute = path.join(root, entry.name); const size = (await stat(absolute)).size;
    try { const value = await readJson(absolute); files.set(relative, value); issues.push(...validatePublicProfileFile(relative, value, { releaseIndex, bundles }, size)); } catch { issues.push(issue("invalid_profile", relative, "profile file is not valid JSON")); }
  }
  issues.push(...validatePublicProfileIndex(await readJson(path.join(root, "index.json")), files));
  if (issues.length) throw new Error(`invalid public profiles: ${issues.map((item) => `${item.code} ${item.path}: ${item.message}`).join("; ")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await validatePublicProfileRepository();
