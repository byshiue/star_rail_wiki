import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import type { DecodedTextMap } from "./text-map";

export type PinnedMappingConfig = {
  repositoryUrl: string;
  revision: string;
  gameVersion: string;
  releaseMarker: string;
  requiredPaths: readonly string[];
};

export type MappingSnapshot = {
  root: string;
  revision: string;
  gameVersion: string;
  textMap: Map<string, string>;
  fileChecksums: Map<string, string>;
  tables: Map<string, Record<string, unknown>[]>;
};

export type VerifiedTextMap = {
  entries: Map<string, string>;
  overlapCount: number;
  ipaOnlyCount: number;
  supplementOnlyCount: number;
  conflicts: TextMapConflict[];
};

export type TextMapConflict = {
  hash: string;
  ipaChecksum: string;
  supplementChecksum: string;
  ipaBytes: number;
  supplementBytes: number;
};

export type TextMapMergeOptions = {
  conflictPolicy?: "reject" | "prefer-supplement";
};

function sha256(bytes: Buffer): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function validateRelativePath(path: string): void {
  if (!path || path.startsWith("/") || path.includes("\\") || path.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new Error(`invalid required mapping path ${path}`);
  }
}

function readPinnedFile(root: string, path: string): Buffer {
  validateRelativePath(path);
  const target = resolve(root, path);
  const lexical = relative(root, target);
  if (lexical.startsWith(`..${sep}`) || lexical === "..") throw new Error(`mapping path escapes root: ${path}`);
  const stat = lstatSync(target);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`mapping path is not a regular file: ${path}`);
  if (realpathSync(target) !== target) throw new Error(`mapping path is not canonical: ${path}`);
  return readFileSync(target);
}

function parseTextMap(bytes: Buffer): Map<string, string> {
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error("TextMap/TextMapCHS.json is not valid UTF-8 JSON");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("TextMap/TextMapCHS.json must be an object");
  const entries = new Map<string, string>();
  for (const [hash, text] of Object.entries(value)) {
    if (!/^\d+$/u.test(hash) || typeof text !== "string") throw new Error(`invalid TextMap entry ${hash}`);
    entries.set(hash, text);
  }
  return entries;
}

export function parseMappingRows(bytes: Buffer): Record<string, unknown>[] {
  let value: unknown;
  try {
    const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const exactHashes = source.replace(/("Hash"\s*:\s*)(\d+)/gu, '$1"$2"');
    value = JSON.parse(exactHashes);
  } catch {
    throw new Error("mapping table is not valid UTF-8 JSON");
  }
  if (!Array.isArray(value)) throw new Error("mapping table must be an array");
  for (const row of value) {
    if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error("mapping table rows must be objects");
  }
  return value as Record<string, unknown>[];
}

export function loadPinnedMapping(rootPath: string, config: PinnedMappingConfig): MappingSnapshot {
  if (!/^[a-f0-9]{40}$/u.test(config.revision)) throw new Error("mapping revision must be a full commit hash");
  if (config.gameVersion !== "4.5" || config.releaseMarker !== "OSPRODWin4.5.0") {
    throw new Error(`mapping release marker does not identify 4.5: ${config.releaseMarker}`);
  }
  if (!/^https:\/\/gitlab\.com\/Dimbreath\/turnbasedgamedata\.git$/u.test(config.repositoryUrl)) {
    throw new Error("mapping repository URL is not approved");
  }
  const root = realpathSync(rootPath);
  const revision = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  if (revision !== config.revision) throw new Error(`mapping revision mismatch: ${revision}`);
  const subject = execFileSync("git", ["log", "-1", "--format=%s"], { cwd: root, encoding: "utf8" }).trim();
  if (!subject.includes(config.releaseMarker)) throw new Error(`mapping release marker ${config.releaseMarker} is absent`);

  const requiredPaths = [...new Set(config.requiredPaths)].sort();
  const files = new Map<string, Buffer>();
  const fileChecksums = new Map<string, string>();
  for (const path of requiredPaths) {
    let bytes: Buffer;
    try {
      bytes = readPinnedFile(root, path);
    } catch (error) {
      throw new Error(`required mapping file ${path} is unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
    files.set(path, bytes);
    fileChecksums.set(path, sha256(bytes));
  }
  const textMapBytes = files.get("TextMap/TextMapCHS.json");
  if (!textMapBytes) throw new Error("required mapping file TextMap/TextMapCHS.json is unavailable");

  const tables = new Map<string, Record<string, unknown>[]>();
  for (const [path, bytes] of files) {
    if (path.startsWith("ExcelOutput/") && path.endsWith(".json")) tables.set(path, parseMappingRows(bytes));
  }
  return { root, revision, gameVersion: config.gameVersion, textMap: parseTextMap(textMapBytes), tables, fileChecksums };
}

export function mergeVerifiedTextMaps(
  ipa: DecodedTextMap,
  supplement: ReadonlyMap<string, string>,
  options: TextMapMergeOptions = {},
): VerifiedTextMap {
  const conflictPolicy = options.conflictPolicy ?? "reject";
  let overlapCount = 0;
  let ipaOnlyCount = 0;
  const conflicts: TextMapConflict[] = [];
  const merged = new Map<string, string>();
  for (const [hash, text] of [...supplement].sort(([left], [right]) => left.localeCompare(right))) merged.set(hash, text);
  for (const [hash, entry] of ipa.entries) {
    const supplementalText = supplement.get(hash);
    if (supplementalText === undefined) {
      ipaOnlyCount += 1;
      merged.set(hash, entry.text);
    } else {
      if (supplementalText !== entry.text) {
        if (conflictPolicy === "reject") throw new Error(`TextMap conflict for overlapping hash ${hash}`);
        conflicts.push({
          hash,
          ipaChecksum: sha256(Buffer.from(entry.text, "utf8")),
          supplementChecksum: sha256(Buffer.from(supplementalText, "utf8")),
          ipaBytes: Buffer.byteLength(entry.text, "utf8"),
          supplementBytes: Buffer.byteLength(supplementalText, "utf8"),
        });
      }
      overlapCount += 1;
    }
  }
  return {
    entries: new Map([...merged].sort(([left], [right]) => left.localeCompare(right))),
    overlapCount,
    ipaOnlyCount,
    supplementOnlyCount: supplement.size - overlapCount,
    conflicts,
  };
}
