import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);

export const SECRET_SCAN_EXCLUDED_PREFIXES = [
  "scripts/secret-scan-fixtures/",
] as const;

export type SecretFinding = { file: string; line: number; rule: string };

function isExcluded(file: string): boolean {
  const normalized = file.split(path.sep).join("/");
  return SECRET_SCAN_EXCLUDED_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function lineAt(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length;
}

function looksHighEntropy(value: string): boolean {
  return /[A-Za-z]/.test(value) && /\d/.test(value) && new Set(value).size >= 10;
}

export function findSecretFindings(file: string, text: string): SecretFinding[] {
  if (isExcluded(file) || text.includes("\0")) return [];
  const findings: SecretFinding[] = [];
  const rules: Array<[string, RegExp]> = [
    ["private-key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
    ["github-token", /(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{82,255})/g],
    ["openai-token", /sk-[A-Za-z0-9]{32,255}/g],
    ["aws-access-key", /AKIA[0-9A-Z]{16}/g],
    ["npm-token", /npm_[A-Za-z0-9]{36,255}/g],
    ["slack-token", /xox[baprs]-[A-Za-z0-9-]{20,255}/g],
    ["gitlab-token", /glpat-[A-Za-z0-9_-]{20,255}/g],
  ];
  for (const [rule, expression] of rules) {
    for (const match of text.matchAll(expression)) {
      findings.push({ file, line: lineAt(text, match.index ?? 0), rule });
    }
  }
  const assignment = /(?:^|[\s,{])["']?(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|secret)["']?\s*[:=]\s*["']?([^"'\s#,}]{24,})/gim;
  for (const match of text.matchAll(assignment)) {
    const value = match[1] ?? "";
    if (value.includes("${{") || !looksHighEntropy(value)) continue;
    findings.push({ file, line: lineAt(text, match.index ?? 0), rule: "high-entropy-assignment" });
  }
  return findings;
}

export async function scanRepository(root = "."): Promise<SecretFinding[]> {
  const { stdout } = await execFileAsync("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
    cwd: root, encoding: "buffer", maxBuffer: 32 * 1024 * 1024,
  });
  const files = stdout.toString("utf8").split("\0").filter(Boolean);
  const findings: SecretFinding[] = [];
  for (const file of files) {
    if (isExcluded(file)) continue;
    const bytes = await readFile(path.join(root, file));
    if (bytes.includes(0)) continue;
    findings.push(...findSecretFindings(file, bytes.toString("utf8")));
  }
  return findings;
}

async function main(): Promise<void> {
  const findings = await scanRepository();
  if (!findings.length) {
    console.log("Secret scan passed: no credential-like values found.");
    return;
  }
  for (const finding of findings) console.error(`${finding.file}:${finding.line} [${finding.rule}] potential secret`);
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
