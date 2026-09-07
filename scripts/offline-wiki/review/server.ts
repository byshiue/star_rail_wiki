import { readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { join } from "node:path";
import { z } from "zod";
import { parseReviewedSummary } from "../editorial";
import type { ReviewedSummary } from "../schema";
import { DraftSummarySchema, promoteDraft, type DraftSummary } from "./drafts";
import { renderReviewPage } from "./page";

export type ReviewServerOptions = {
  host: "127.0.0.1" | "::1" | string;
  port: number;
  draftsRoot: string;
  editorialRoot?: string;
};

const FORM_LIMIT_BYTES = 128 * 1024;

function loadDrafts(root: string): Array<{ filename: string; draft: DraftSummary }> {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".draft.json"))
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => ({
      filename: entry.name,
      draft: DraftSummarySchema.parse(JSON.parse(readFileSync(join(root, entry.name), "utf8"))),
    }));
}

async function readForm(request: IncomingMessage): Promise<URLSearchParams> {
  if (!request.headers["content-type"]?.startsWith("application/x-www-form-urlencoded")) {
    throw new Error("review form must use application/x-www-form-urlencoded");
  }
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.byteLength;
    if (bytes > FORM_LIMIT_BYTES) throw new Error("review form exceeds byte limit");
    chunks.push(buffer);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
}

function summaryFilename(kind: ReviewedSummary["entityKind"]): string {
  return ({
    character: "characters.json",
    "light-cone": "light-cones.json",
    "relic-set": "relics.json",
    "divergent-universe": "divergent-universe.json",
  })[kind];
}

function writeReviewedSummary(editorialRoot: string, summary: ReviewedSummary): void {
  const path = join(editorialRoot, "summaries", summaryFilename(summary.entityKind));
  const existing = z.array(z.unknown()).parse(JSON.parse(readFileSync(path, "utf8")))
    .map(parseReviewedSummary)
    .filter((item) => item.logicalId !== summary.logicalId || item.releaseId !== summary.releaseId);
  const updated = [...existing, summary].sort((left, right) => (
    left.logicalId.localeCompare(right.logicalId) || left.releaseId.localeCompare(right.releaseId)
  ));
  const temporaryPath = `${path}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify(updated, null, 2)}\n`, { flag: "wx" });
  renameSync(temporaryPath, path);
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: ReviewServerOptions,
): Promise<void> {
  if (request.method === "GET" && request.url === "/") {
    const page = renderReviewPage(loadDrafts(options.draftsRoot));
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'",
      "x-content-type-options": "nosniff",
    });
    response.end(page);
    return;
  }
  if (request.method === "POST" && request.url === "/api/promote") {
    if (!options.editorialRoot) throw new Error("review server has no editorial output root");
    const form = await readForm(request);
    const filename = form.get("filename") ?? "";
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/.test(filename)) throw new Error("invalid draft filename");
    const record = loadDrafts(options.draftsRoot).find((item) => item.filename === filename);
    if (!record) throw new Error("draft was not found");
    const decision = form.get("decision");
    if (decision === "accept") {
      const summary = promoteDraft(record.draft, {
        decision,
        reviewer: form.get("reviewer") ?? "",
        reviewedAt: new Date().toISOString(),
        editedSummary: form.get("summary") ?? "",
      });
      writeReviewedSummary(options.editorialRoot, summary);
    } else if (decision !== "reject") {
      throw new Error("review decision must be accept or reject");
    }
    response.writeHead(303, { location: "/" });
    response.end();
    return;
  }
  response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  response.end("Not found");
}

export async function startReviewServer(options: ReviewServerOptions): Promise<Server> {
  if (options.host !== "127.0.0.1" && options.host !== "::1") {
    throw new Error("offline wiki review server must bind to a loopback host");
  }
  const server = createServer((request, response) => {
    handleRequest(request, response, options).catch((error: unknown) => {
      if (response.headersSent) {
        response.end();
        return;
      }
      response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.message : String(error));
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server;
}
