import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { inspectIpa, readIpaEntry } from "./ipa-reader";

function createIpa(binaryVersion?: string): string {
  const root = mkdtempSync(join(tmpdir(), "hsr-ipa-fixture-"));
  const raw = join(root, "Payload", "hkrpg.app", "Data", "Raw");
  mkdirSync(join(raw, "DesignData", "iOS", "cn"), { recursive: true });
  if (binaryVersion !== undefined) writeFileSync(join(raw, "BinaryVersion.bytes"), binaryVersion);
  writeFileSync(join(raw, "DesignData", "iOS", "cn", "fixture.bytes"), "text-map");
  const ipa = join(root, "fixture.ipa");
  const result = spawnSync("/usr/bin/zip", ["-q", "-r", ipa, "Payload"], { cwd: root });
  if (result.status !== 0) throw new Error(result.stderr.toString("utf8"));
  return ipa;
}

describe("IPA reader", () => {
  it("finds the 4.5 build and Chinese DesignData without extracting the archive", () => {
    const ipa = createIpa(["prefix", "V4.5Live", "20260813-0422", "PROD", ""].join("\0"));
    const result = inspectIpa(ipa);

    expect(result).toMatchObject({
      liveVersion: "V4.5Live",
      gameVersion: "4.5",
      buildTimestamp: "20260813-0422",
      binaryVersionEntry: "Payload/hkrpg.app/Data/Raw/BinaryVersion.bytes",
      chineseTextMapEntry: "Payload/hkrpg.app/Data/Raw/DesignData/iOS/cn/fixture.bytes",
    });
    expect(result.ipaChecksum).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(readIpaEntry(ipa, result.chineseTextMapEntry).toString()).toBe("text-map");
  });

  it("rejects a non-ZIP file and a ZIP without BinaryVersion", () => {
    const root = mkdtempSync(join(tmpdir(), "hsr-ipa-invalid-"));
    const invalid = join(root, "invalid.ipa");
    writeFileSync(invalid, "not a zip");
    expect(() => inspectIpa(invalid)).toThrow(/ZIP|archive/i);
    expect(() => inspectIpa(createIpa(undefined))).toThrow(/BinaryVersion/i);
  });

  it("rejects a different live version", () => {
    expect(() => inspectIpa(createIpa(["V4.4Live", "20260701-0101", "PROD"].join("\0")))).toThrow(/4\.5/);
  });
});
