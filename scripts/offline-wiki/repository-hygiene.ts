import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROHIBITED_BINARY = /\.(?:pdf|png|jpe?g|webp|gif|avif)$/i;

export function validateTrackedFiles(paths: string[]): string[] {
  return paths.filter((path) => (
    path.startsWith(".local/offline-wiki/")
    || (path.startsWith("data/offline-wiki/") && PROHIBITED_BINARY.test(path))
    || (path.startsWith("data/offline-wiki/") && path.endsWith(".draft.json"))
  ));
}

function runCli(): void {
  const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
  const prohibited = validateTrackedFiles(tracked);
  if (prohibited.length > 0) {
    throw new Error(`prohibited offline Wiki artifacts are tracked:\n${prohibited.join("\n")}`);
  }
  process.stdout.write(`Offline Wiki repository hygiene passed for ${tracked.length} tracked files.\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runCli();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
