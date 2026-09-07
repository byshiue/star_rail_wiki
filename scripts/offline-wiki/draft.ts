import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { EntityProvenance } from "../../src/domain/entities";
import { loadDocumentCatalog } from "./catalog";
import { loadEditorialData } from "./editorial";
import type { DocumentCatalog, ReviewedSummary } from "./schema";

export type DraftRequest = {
  logicalId: string;
  entityKind: ReviewedSummary["entityKind"];
  releaseId: string;
  name: string;
  sourceText: string;
  provenance: EntityProvenance[];
  instruction: string;
  outputFilename: string;
};

function outputFilename(logicalId: string): string {
  return `${logicalId.replaceAll(/[^A-Za-z0-9_-]/g, "-")}.draft.json`;
}

export function createDraftRequests(
  catalog: DocumentCatalog,
  summaries: ReviewedSummary[],
): DraftRequest[] {
  const reviewed = new Set(summaries
    .filter((summary) => summary.releaseId === catalog.release.id)
    .map((summary) => summary.logicalId));
  const entities = [
    ...catalog.characters.map((item) => ({ ...item, entityKind: "character" as const, sourceText: item.description })),
    ...catalog.lightCones.map((item) => ({ ...item, entityKind: "light-cone" as const, sourceText: item.description })),
    ...catalog.relicSets.map((item) => ({ ...item, entityKind: "relic-set" as const, sourceText: item.description })),
    ...catalog.divergentUniverse.map((item) => ({
      ...item,
      entityKind: "divergent-universe" as const,
      sourceText: item.description,
    })),
  ];
  return entities.filter((item) => !reviewed.has(item.logicalId)).map((item) => ({
    logicalId: item.logicalId,
    entityKind: item.entityKind,
    releaseId: catalog.release.id,
    name: item.name,
    sourceText: item.sourceText,
    provenance: item.provenance,
    instruction: "仅依据列出的公开来源撰写简体中文原创故事摘要；不要复制官方长篇原文。若来源不足，请保留为未完成请求。",
    outputFilename: outputFilename(item.logicalId),
  }));
}

function runCli(): void {
  const arguments_ = process.argv.slice(2);
  const releaseIndex = arguments_.indexOf("--release");
  const releaseId = releaseIndex === -1 ? undefined : arguments_[releaseIndex + 1];
  if (!releaseId) throw new Error("usage: npm run docs:draft -- --release <exact-release-id>");
  const editorial = loadEditorialData(join(process.cwd(), "data", "offline-wiki"));
  const catalog = loadDocumentCatalog(
    join(process.cwd(), "public", "data", "releases"),
    releaseId,
    editorial,
  );
  const requests = createDraftRequests(catalog, editorial.summaries);
  const draftsRoot = join(process.cwd(), ".local", "offline-wiki", "drafts", releaseId);
  mkdirSync(draftsRoot, { recursive: true });
  const path = join(draftsRoot, "draft-requests.json");
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(requests, null, 2)}\n`, { flag: "wx" });
  renameSync(temporaryPath, path);
  process.stdout.write(`${path}\n${requests.length} summaries require local Agent drafting and human review.\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
