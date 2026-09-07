import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { loadDocumentCatalog } from "./catalog";
import { startReviewServer } from "./review/server";

async function runCli(): Promise<void> {
  const arguments_ = process.argv.slice(2);
  const releaseIndex = arguments_.indexOf("--release");
  const portIndex = arguments_.indexOf("--port");
  const releaseId = releaseIndex === -1 ? undefined : arguments_[releaseIndex + 1];
  const port = portIndex === -1 ? 4174 : Number(arguments_[portIndex + 1]);
  if (!releaseId || !Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("usage: npm run docs:review -- --release <exact-release-id> [--port 4174]");
  }
  loadDocumentCatalog(join(process.cwd(), "public", "data", "releases"), releaseId);
  const draftsRoot = join(process.cwd(), ".local", "offline-wiki", "drafts", releaseId);
  mkdirSync(draftsRoot, { recursive: true });
  const server = await startReviewServer({
    host: "127.0.0.1",
    port,
    draftsRoot,
    editorialRoot: join(process.cwd(), "data", "offline-wiki"),
  });
  const address = server.address() as AddressInfo;
  process.stdout.write(`Offline Wiki review: http://127.0.0.1:${address.port}/\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
