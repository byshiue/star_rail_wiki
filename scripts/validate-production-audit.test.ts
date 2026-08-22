import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GameReleaseBundleSchema } from "../src/domain/releases";
import { CoverageReportSchema } from "./game-data/checkEffectCoverage";
import { sortedIdListSha256 } from "./game-data/orphanAudit";
import { validateProductionAudit } from "./validate-production-audit";

const releaseId = "4.4-cn-2026-08-21";

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "star-rail-production-audit-"));
  const source = path.resolve("data/releases", releaseId);
  const target = path.join(root, "data/releases", releaseId);
  await cp(source, target, { recursive: true });
  const publicRoot = path.resolve("public/data/releases", releaseId);
  const release = JSON.parse(await readFile(path.join(publicRoot, "release.json"), "utf8"));
  const entities = JSON.parse(await readFile(path.join(publicRoot, "entities.json"), "utf8"));
  const coverage = CoverageReportSchema.parse(JSON.parse(
    await readFile(path.join(publicRoot, "coverage.json"), "utf8"),
  ));
  return { root, target, bundle: GameReleaseBundleSchema.parse({ release, entities }), coverage };
}

describe("production orphan raw-source boundary", () => {
  it("rejects coordinated report and audit-summary deletion against unchanged raw source", async () => {
    const { root, target, bundle, coverage } = await fixture();
    const reportPath = path.join(target, "orphan-character-ranks.json");
    const auditPath = path.join(target, "audit.json");
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    const deleted = report.orphanRankIds.at(-1);
    report.rawRankIds = report.rawRankIds.filter((id: string) => id !== deleted);
    report.orphanRankIds = report.orphanRankIds.filter((id: string) => id !== deleted);
    report.orphanIdsSha256 = sortedIdListSha256(report.orphanRankIds);
    const audit = JSON.parse(await readFile(auditPath, "utf8"));
    audit.excludedSourceRecords.characterRanks.count = report.orphanRankIds.length;
    audit.excludedSourceRecords.characterRanks.idListSha256 = report.orphanIdsSha256;
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await writeFile(auditPath, `${JSON.stringify(audit, null, 2)}\n`, "utf8");

    await expect(validateProductionAudit(root, bundle, coverage)).rejects.toThrow(/immutable raw source snapshot/i);
  });

  it("rejects edits to the checked raw snapshot before parsing it", async () => {
    const { root, target, bundle, coverage } = await fixture();
    const rawPath = path.join(target, "source/index_new/cn/character_ranks.json");
    await writeFile(rawPath, `${await readFile(rawPath, "utf8")} `, "utf8");

    await expect(validateProductionAudit(root, bundle, coverage)).rejects.toThrow(/immutable raw source checksum mismatch/i);
  });
});
