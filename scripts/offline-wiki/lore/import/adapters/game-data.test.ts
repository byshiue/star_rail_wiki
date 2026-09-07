import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { LocalLoreManifest } from "../manifest";
import { convertCompatibleGameData } from "./game-data";

const checksum = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;

function fixture(options: { missingHash?: boolean; releaseId?: string | undefined; unsafeText?: boolean } = {}) {
  const sourceRoot = mkdtempSync(join(tmpdir(), "game-data-adapter-"));
  const excel = JSON.stringify({ releaseId: options.releaseId ?? "4.4-fixture", locale: "zh-CN", rows: [{
    id: "mission-1", logicalId: "lore:mission:companion:1", family: "mission", kind: "companion", nameHash: "1", storyId: "story-1",
  }] });
  const textMap = JSON.stringify({ "1": "测试任务", "2": "甲", "3": options.unsafeText ? "正文 <tag> https://bad.invalid/body" : "第一分支", "4": "乙", ...(options.missingHash ? {} : { "5": "第二分支" }) });
  const story = JSON.stringify({ stories: [{ id: "story-1", sections: [
    { order: 2, speakerHash: "4", branch: "B", bodyHash: "5" },
    { order: 1, speakerHash: "2", branch: "A", bodyHash: "3" },
  ] }] });
  const files = [["ExcelOutput/LoreEntries.json", excel], ["TextMap/TextMapCHS.json", textMap], ["Story/Story.json", story]] as const;
  for (const directory of ["ExcelOutput", "TextMap", "Story"]) mkdirSync(join(sourceRoot, directory));
  for (const [path, text] of files) writeFileSync(join(sourceRoot, path), text);
  const manifest: LocalLoreManifest = {
    schemaVersion: 1, releaseId: "4.4-fixture", locale: "zh-CN",
    source: { name: "Local fixture", revision: "fixture-revision", exportedAt: "2026-09-06T00:00:00.000Z" },
    adapter: "compatible-game-data", adapterVersion: 1, families: ["mission"], userProvided: true,
    files: files.map(([path, text]) => ({ path, bytes: Buffer.byteLength(text), checksum: checksum(text) })),
  };
  return { sourceRoot, manifest };
}

describe("convertCompatibleGameData", () => {
  it("resolves text hashes while preserving section order and dialogue branches", () => {
    const { sourceRoot, manifest } = fixture();
    const result = convertCompatibleGameData({ manifest, sourceRoot });
    expect(result.rejections).toEqual([]);
    expect(result.entries).toEqual([{
      sourcePath: "Story/Story.json",
      input: {
        logicalId: "lore:mission:companion:1", family: "mission", kind: "companion", name: "测试任务",
        releaseId: "4.4-fixture", locale: "zh-CN", sourceRevision: "fixture-revision",
        sections: [
          { order: 1, title: null, speaker: "甲", branch: "A", body: "第一分支" },
          { order: 2, title: null, speaker: "乙", branch: "B", body: "第二分支" },
        ],
      },
    }]);
  });

  it("rejects a row when any referenced text hash is absent", () => {
    const { sourceRoot, manifest } = fixture({ missingHash: true });
    const result = convertCompatibleGameData({ manifest, sourceRoot });
    expect(result.entries).toEqual([]);
    expect(result.rejections).toEqual([{ sourcePath: "Story/Story.json", logicalId: "lore:mission:companion:1", reason: "missing-text", detail: "referenced-text-missing" }]);
  });

  it("requires exactly the declared compatible table layout", () => {
    const { sourceRoot, manifest } = fixture();
    manifest.files[0] = { ...manifest.files[0], path: "Other/LoreEntries.json" };
    expect(convertCompatibleGameData({ manifest, sourceRoot })).toMatchObject({ entries: [], rejections: [{ reason: "malformed-source", detail: "required-layout-missing" }] });
  });

  it("normalizes resolved game-data strings to safe plain text", () => {
    const { sourceRoot, manifest } = fixture({ unsafeText: true });
    const result = convertCompatibleGameData({ manifest, sourceRoot });
    expect(result.entries[0].input.sections[0].body).toBe("正文 tag");
    expect(JSON.stringify(result.entries)).not.toMatch(/<|>|https?:\/\//i);
  });

  it.each(["latest", "4.5-cn-2026-09-01", undefined])("rejects ambiguous or out-of-scope release evidence %s", (releaseId) => {
    const { sourceRoot, manifest } = fixture({ releaseId });
    if (releaseId === undefined) {
      const excelPath = join(sourceRoot, "ExcelOutput/LoreEntries.json");
      const value = JSON.parse(readFileSync(excelPath, "utf8"));
      delete value.releaseId;
      const text = JSON.stringify(value);
      writeFileSync(excelPath, text);
      manifest.files[0] = { ...manifest.files[0], bytes: Buffer.byteLength(text), checksum: checksum(text) };
    }
    expect(convertCompatibleGameData({ manifest, sourceRoot })).toMatchObject({ entries: [], rejections: [{ reason: "ambiguous-release", detail: "release-evidence-mismatch" }] });
  });
});
