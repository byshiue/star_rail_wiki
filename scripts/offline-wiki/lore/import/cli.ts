#!/usr/bin/env node
import { resolve } from "node:path";
import { importLocalLore } from "./transaction";

function option(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value || value.startsWith("--")) throw new Error(`missing required option ${name}`);
  return value;
}

try {
  const report = importLocalLore({
    repositoryRoot: process.cwd(),
    releaseId: option("--release"),
    manifestPath: resolve(option("--manifest")),
    sourceRoot: resolve(option("--source-root")),
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status === "rejected") process.exitCode = 1;
} catch (error) {
  const message = error instanceof Error ? error.message : "local lore import failed";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
