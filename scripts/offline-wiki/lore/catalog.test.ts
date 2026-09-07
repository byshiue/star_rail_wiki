import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadLoreCatalog } from "./catalog";

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "__fixtures__", "lore");

function mutateFixture(
  filename: string,
  mutate: (records: Record<string, unknown>[]) => void,
): string {
  const root = mkdtempSync(join(tmpdir(), "offline-wiki-lore-"));
  cpSync(join(fixtureRoot, "4.4-fixture"), join(root, "4.4-fixture"), { recursive: true });
  const path = join(root, "4.4-fixture", filename);
  const records = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>[];
  mutate(records);
  writeFileSync(path, JSON.stringify(records));
  return root;
}

function checksumWithoutContentChecksum(record: Record<string, unknown>): string {
  const { contentChecksum: _contentChecksum, ...content } = record;
  return `sha256:${createHash("sha256").update(JSON.stringify(content), "utf8").digest("hex")}`;
}

describe("loadLoreCatalog", () => {
  it("loads every lore family in Chinese-name order and preserves a missing baseline", () => {
    const catalog = loadLoreCatalog(fixtureRoot, "4.4-fixture");

    expect(catalog.releaseId).toBe("4.4-fixture");
    expect(catalog.records.map((record) => record.logicalId)).toEqual([
      "lore:du:equation:aha",
      "lore:worldview:location:belobog",
      "lore:mission:trailblaze:silent-star",
      "lore:collectible:readable:origami-bird",
    ]);
    expect(Object.fromEntries(Object.entries(catalog.byFamily)
      .map(([family, records]) => [family, records.length]))).toEqual({
      "divergent-universe": 1,
      worldview: 1,
      mission: 1,
      collectible: 1,
    });
    expect(catalog.baselines.find((baseline) => baseline.family === "mission")).toMatchObject({
      baselineStatus: "missing",
      expectedCount: null,
    });
  });

  it("verifies checksums from canonical parsed fields instead of input key order", () => {
    const root = mutateFixture("worldview.json", (records) => {
      records[0] = Object.fromEntries(Object.entries(records[0]).reverse());
    });

    expect(loadLoreCatalog(root, "4.4-fixture").byFamily.worldview).toHaveLength(1);
  });

  it("rejects record checksum drift", () => {
    const root = mutateFixture("worldview.json", (records) => {
      records[0].description = "篡改后的说明。";
    });

    expect(() => loadLoreCatalog(root, "4.4-fixture")).toThrow(/checksum/i);
  });

  it("rejects records from another release even when their checksum is valid", () => {
    const root = mutateFixture("worldview.json", (records) => {
      records[0].releaseId = "4.5-fixture";
      records[0].contentChecksum = checksumWithoutContentChecksum(records[0]);
    });

    expect(() => loadLoreCatalog(root, "4.4-fixture")).toThrow(/release/i);
  });

  it("rejects duplicate logical IDs", () => {
    const root = mutateFixture("missions.json", (records) => {
      records.push({ ...records[0] });
    });

    expect(() => loadLoreCatalog(root, "4.4-fixture")).toThrow(/duplicate/i);
  });

  it("rejects a dangling non-external lore relationship", () => {
    const root = mutateFixture("missions.json", (records) => {
      records[0].relationships = [{
        type: "located-in",
        targetLogicalId: "lore:worldview:location:missing",
        external: false,
      }];
      records[0].contentChecksum = checksumWithoutContentChecksum(records[0]);
    });

    expect(() => loadLoreCatalog(root, "4.4-fixture")).toThrow(/relationship/i);
  });
});
