import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { fetchSource } from "./fetchSource";
import { loadSourceManifest } from "./sourceManifest";

const sortedUniqueIds = z.array(z.string().min(1)).superRefine((ids, context) => {
  if (new Set(ids).size !== ids.length || ids.some((id, index) => index > 0 && ids[index - 1]!.localeCompare(id) >= 0)) {
    context.addIssue({ code: "custom", message: "IDs must be unique and sorted" });
  }
});

export const CharacterRankOrphanAuditSchema = z.strictObject({
  schemaVersion: z.literal(1),
  releaseId: z.string().min(1),
  sourceRevision: z.string().regex(/^[a-f0-9]{40}$/),
  charactersPath: z.literal("index_new/cn/characters.json"),
  characterRanksPath: z.literal("index_new/cn/character_ranks.json"),
  charactersFileChecksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  characterRanksFileChecksum: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  rawRankIds: sortedUniqueIds,
  canonicalReferencedRankIds: sortedUniqueIds,
  orphanRankIds: sortedUniqueIds,
  orphanIdsSha256: z.string().regex(/^sha256:[a-f0-9]{64}$/),
});
export type CharacterRankOrphanAudit = z.infer<typeof CharacterRankOrphanAuditSchema>;
export type CharacterRankRawSnapshot = {
  charactersValue: unknown;
  characterRanksValue: unknown;
  charactersChecksum: string;
  characterRanksChecksum: string;
};

function records(value: unknown): Array<Record<string, unknown>> {
  return Object.values(z.record(z.string(), z.record(z.string(), z.unknown())).parse(value));
}

function ids(value: unknown): string[] {
  return z.array(z.union([z.string(), z.number()])).parse(value ?? []).map(String);
}

function sorted(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

export function sortedIdListSha256(values: readonly string[]): string {
  return `sha256:${createHash("sha256").update(values.join("\n")).digest("hex")}`;
}

export function buildCharacterRankOrphanAudit(
  releaseId: string,
  sourceRevision: string,
  charactersValue: unknown,
  characterRanksValue: unknown,
  checksums: { characters?: string; characterRanks?: string } = {},
): CharacterRankOrphanAudit {
  const rawRankIds = sorted(records(characterRanksValue).map((rank) => String(rank.id)));
  const canonicalReferencedRankIds = sorted(records(charactersValue).flatMap((character) => ids(character.ranks)));
  const rawSet = new Set(rawRankIds);
  const missing = canonicalReferencedRankIds.find((id) => !rawSet.has(id));
  if (missing) throw new Error(`canonical rank ${missing} is missing from raw rank snapshot`);
  const canonicalSet = new Set(canonicalReferencedRankIds);
  const orphanRankIds = rawRankIds.filter((id) => !canonicalSet.has(id));
  return CharacterRankOrphanAuditSchema.parse({
    schemaVersion: 1, releaseId, sourceRevision,
    charactersPath: "index_new/cn/characters.json",
    characterRanksPath: "index_new/cn/character_ranks.json",
    charactersFileChecksum: checksums.characters ?? `sha256:${"0".repeat(64)}`,
    characterRanksFileChecksum: checksums.characterRanks ?? `sha256:${"0".repeat(64)}`,
    rawRankIds, canonicalReferencedRankIds, orphanRankIds,
    orphanIdsSha256: sortedIdListSha256(orphanRankIds),
  });
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

export function validateCharacterRankOrphanAudit(
  input: CharacterRankOrphanAudit,
  snapshot: CharacterRankRawSnapshot,
  bundleCanonicalRankIds: readonly string[],
): CharacterRankOrphanAudit {
  const audit = CharacterRankOrphanAuditSchema.parse(input);
  const recomputed = buildCharacterRankOrphanAudit(
    audit.releaseId,
    audit.sourceRevision,
    snapshot.charactersValue,
    snapshot.characterRanksValue,
    { characters: snapshot.charactersChecksum, characterRanks: snapshot.characterRanksChecksum },
  );
  if (
    audit.charactersFileChecksum !== recomputed.charactersFileChecksum
    || audit.characterRanksFileChecksum !== recomputed.characterRanksFileChecksum
    || !sameIds(audit.rawRankIds, recomputed.rawRankIds)
    || !sameIds(audit.canonicalReferencedRankIds, recomputed.canonicalReferencedRankIds)
    || !sameIds(audit.orphanRankIds, recomputed.orphanRankIds)
    || audit.orphanIdsSha256 !== recomputed.orphanIdsSha256
  ) {
    throw new Error("orphan report does not match the immutable raw source snapshot recomputation");
  }
  if (!sameIds(sorted(bundleCanonicalRankIds), recomputed.canonicalReferencedRankIds)) {
    throw new Error("canonical rank list does not match generated bundle eidolons");
  }
  return audit;
}

function option(name: string): string {
  const index = process.argv.indexOf(name);
  const value = process.argv[index + 1];
  if (index < 0 || !value || value.startsWith("--")) throw new Error(`missing required option ${name}`);
  return value;
}

async function main(): Promise<void> {
  const manifest = await loadSourceManifest(option("--manifest"));
  const source = await fetchSource(manifest, option("--source-root"));
  const characters = source.files.get("index_new/cn/characters.json");
  const ranks = source.files.get("index_new/cn/character_ranks.json");
  if (!characters || !ranks || characters.source.revision !== ranks.source.revision) {
    throw new Error("orphan audit requires character and rank indexes from one immutable revision");
  }
  const report = buildCharacterRankOrphanAudit(
    manifest.releaseId, characters.source.revision, characters.value, ranks.value,
    { characters: characters.checksum, characterRanks: ranks.checksum },
  );
  await writeFile(option("--output"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${report.releaseId}: ${report.orphanRankIds.length} orphan character ranks\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
