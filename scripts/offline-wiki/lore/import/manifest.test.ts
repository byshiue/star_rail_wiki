import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadLocalLoreManifest, readValidatedLocalLoreFile, validateExactPathSet } from "./manifest";

const FIXTURE_RELEASE = "4.4-fixture";

function checksum(bytes: Uint8Array | string): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function createFixture(contents = "{}\n") {
  const sourceRoot = mkdtempSync(join(tmpdir(), "offline-wiki-lore-import-"));
  const relativePath = "worldview.jsonl";
  const sourceBytes = Buffer.from(contents, "utf8");
  writeFileSync(join(sourceRoot, relativePath), sourceBytes);
  const manifest = {
    schemaVersion: 1,
    releaseId: FIXTURE_RELEASE,
    locale: "zh-CN",
    source: {
      name: "User-provided fixture export",
      revision: "fixture-revision",
      exportedAt: "2026-09-06T00:00:00.000Z",
    },
    adapter: "canonical-jsonl",
    adapterVersion: 1,
    families: ["worldview"],
    userProvided: true,
    files: [{
      path: relativePath,
      bytes: sourceBytes.byteLength,
      checksum: checksum(sourceBytes),
    }],
  };
  const manifestPath = join(sourceRoot, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest));
  return { manifest, manifestPath, sourceRoot };
}

function writeManifest(path: string, manifest: unknown): void {
  writeFileSync(path, JSON.stringify(manifest));
}

function loadFixture(fixture: ReturnType<typeof createFixture>) {
  return loadLocalLoreManifest(fixture.manifestPath, FIXTURE_RELEASE, fixture.sourceRoot);
}

describe("local lore manifest", () => {
  it("rejects a regular file replaced after manifest validation", () => {
    const fixture = createFixture("original\n");
    const loaded = loadFixture(fixture);
    unlinkSync(join(fixture.sourceRoot, "worldview.jsonl"));
    writeFileSync(join(fixture.sourceRoot, "worldview.jsonl"), "replacement\n");
    expect(() => readValidatedLocalLoreFile(loaded, fixture.sourceRoot, "worldview.jsonl")).toThrow(/byte|checksum|changed/i);
  });

  it("rejects a symlink substituted after manifest validation", () => {
    const fixture = createFixture("original\n");
    const loaded = loadFixture(fixture);
    const outside = mkdtempSync(join(tmpdir(), "offline-wiki-read-race-"));
    writeFileSync(join(outside, "replacement.jsonl"), "original\n");
    unlinkSync(join(fixture.sourceRoot, "worldview.jsonl"));
    symlinkSync(join(outside, "replacement.jsonl"), join(fixture.sourceRoot, "worldview.jsonl"));
    expect(() => readValidatedLocalLoreFile(loaded, fixture.sourceRoot, "worldview.jsonl")).toThrow(/symlink|canonical/i);
  });

  it("reapplies byte, UTF-8, and checksum checks when consuming a validated file", () => {
    const fixture = createFixture("original\n");
    const loaded = loadFixture(fixture);
    writeFileSync(join(fixture.sourceRoot, "worldview.jsonl"), Buffer.from([0xc3, 0x28]));
    expect(() => readValidatedLocalLoreFile(loaded, fixture.sourceRoot, "worldview.jsonl")).toThrow(/byte|UTF-8|checksum/i);
  });
  it("rejects a declared path missing from the stable enumeration", () => {
    expect(() => validateExactPathSet(
      new Set(["nested/worldview.jsonl"]),
      new Set(),
    )).toThrow(/declared.*missing|missing.*enumeration/i);
  });

  it("loads a release-locked user-provided manifest and excludes its own file", () => {
    const fixture = createFixture();
    expect(loadFixture(fixture)).toMatchObject(fixture.manifest);
  });

  it.each([
    ["latest", "latest"],
    ["4.5-cn-2026-09-01", "4.5"],
    ["4.4-cn-2026-08-21", "release"],
  ])("rejects release %s when %s does not exactly match", (releaseId, message) => {
    const fixture = createFixture();
    writeManifest(fixture.manifestPath, { ...fixture.manifest, releaseId });
    expect(() => loadFixture(fixture)).toThrow(new RegExp(message, "i"));
  });

  it("rejects a manifest that is not explicitly user-provided", () => {
    const fixture = createFixture();
    writeManifest(fixture.manifestPath, { ...fixture.manifest, userProvided: false });
    expect(() => loadFixture(fixture)).toThrow(/user.provided/i);
  });

  it("rejects adapters outside the strict offline registry", () => {
    const fixture = createFixture();
    writeManifest(fixture.manifestPath, { ...fixture.manifest, adapter: "fetch-from-url" });
    expect(() => loadFixture(fixture)).toThrow(/adapter|enum|option/i);
  });

  it.each([
    "/tmp/worldview.jsonl",
    "../worldview.jsonl",
    "nested/../../worldview.jsonl",
    "nested/../worldview.jsonl",
    "./worldview.jsonl",
    "C:/worldview.jsonl",
    "C:\\worldview.jsonl",
    "C:worldview.jsonl",
    "\\\\server\\share\\worldview.jsonl",
    "//server/share/worldview.jsonl",
    "\\\\?\\C:\\worldview.jsonl",
    "\\\\.\\PhysicalDrive0",
  ])(
    "rejects a non-normalized or escaping path: %s",
    (path) => {
      const fixture = createFixture();
      writeManifest(fixture.manifestPath, {
        ...fixture.manifest,
        files: [{ ...fixture.manifest.files[0], path }],
      });
      expect(() => loadFixture(fixture)).toThrow(/path/i);
    },
  );

  it("rejects duplicate normalized file paths", () => {
    const fixture = createFixture();
    writeManifest(fixture.manifestPath, {
      ...fixture.manifest,
      files: [fixture.manifest.files[0], { ...fixture.manifest.files[0] }],
    });
    expect(() => loadFixture(fixture)).toThrow(/duplicate/i);
  });

  it("rejects the manifest itself when it is declared as source input", () => {
    const fixture = createFixture();
    writeManifest(fixture.manifestPath, {
      ...fixture.manifest,
      files: [
        fixture.manifest.files[0],
        { path: "manifest.json", bytes: 1, checksum: `sha256:${"a".repeat(64)}` },
      ],
    });
    expect(() => loadFixture(fixture)).toThrow(/manifest.*input|declare.*manifest/i);
  });

  it("rejects regular files that the manifest did not declare", () => {
    const fixture = createFixture();
    mkdirSync(join(fixture.sourceRoot, "nested"));
    writeFileSync(join(fixture.sourceRoot, "nested", "extra.json"), "{}");
    expect(() => loadFixture(fixture)).toThrow(/undeclared/i);
  });

  it("rejects declared byte counts that do not match lstat", () => {
    const fixture = createFixture();
    writeManifest(fixture.manifestPath, {
      ...fixture.manifest,
      files: [{ ...fixture.manifest.files[0], bytes: fixture.manifest.files[0].bytes + 1 }],
    });
    expect(() => loadFixture(fixture)).toThrow(/byte/i);
  });

  it("rejects declared checksums that do not match file contents", () => {
    const fixture = createFixture();
    writeManifest(fixture.manifestPath, {
      ...fixture.manifest,
      files: [{ ...fixture.manifest.files[0], checksum: `sha256:${"a".repeat(64)}` }],
    });
    expect(() => loadFixture(fixture)).toThrow(/checksum/i);
  });

  it("rejects files larger than 16 MiB before reading", () => {
    const fixture = createFixture();
    writeManifest(fixture.manifestPath, {
      ...fixture.manifest,
      files: [{ ...fixture.manifest.files[0], bytes: 16 * 1024 * 1024 + 1 }],
    });
    expect(() => loadFixture(fixture)).toThrow(/16 MiB|file.*limit/i);
  });

  it("rejects batches larger than 512 MiB before reading", () => {
    const fixture = createFixture();
    const files = Array.from({ length: 33 }, (_, index) => ({
      ...fixture.manifest.files[0],
      path: `part-${index}.jsonl`,
      bytes: 16 * 1024 * 1024,
    }));
    writeManifest(fixture.manifestPath, { ...fixture.manifest, files });
    expect(() => loadFixture(fixture)).toThrow(/512 MiB|batch.*limit/i);
  });

  it("rejects invalid UTF-8 input", () => {
    const fixture = createFixture();
    const invalid = Buffer.from([0xc3, 0x28]);
    writeFileSync(join(fixture.sourceRoot, "worldview.jsonl"), invalid);
    writeManifest(fixture.manifestPath, {
      ...fixture.manifest,
      files: [{ path: "worldview.jsonl", bytes: invalid.byteLength, checksum: checksum(invalid) }],
    });
    expect(() => loadFixture(fixture)).toThrow(/UTF-8/i);
  });

  it("rejects a declared symlink whose target escapes sourceRoot", () => {
    const fixture = createFixture();
    const outsideRoot = mkdtempSync(join(tmpdir(), "offline-wiki-lore-outside-"));
    const outsidePath = join(outsideRoot, "outside.jsonl");
    writeFileSync(outsidePath, "outside\n");
    symlinkSync(outsidePath, join(fixture.sourceRoot, "escape.jsonl"));
    writeManifest(fixture.manifestPath, {
      ...fixture.manifest,
      files: [{ path: "escape.jsonl", bytes: 8, checksum: checksum("outside\n") }],
    });
    expect(() => loadFixture(fixture)).toThrow(/symlink|outside|escape/i);
  });

  it("rejects directory symlinks instead of following them", () => {
    const fixture = createFixture();
    mkdirSync(join(fixture.sourceRoot, "real"));
    writeFileSync(join(fixture.sourceRoot, "real", "nested.jsonl"), "nested\n");
    symlinkSync(join(fixture.sourceRoot, "real"), join(fixture.sourceRoot, "linked"));
    writeManifest(fixture.manifestPath, {
      ...fixture.manifest,
      files: [
        fixture.manifest.files[0],
        { path: "real/nested.jsonl", bytes: 7, checksum: checksum("nested\n") },
      ],
    });
    expect(() => loadFixture(fixture)).toThrow(/directory symlink|symlink/i);
  });

  it("rejects a source root supplied through a symlink", () => {
    const fixture = createFixture();
    const wrapper = mkdtempSync(join(tmpdir(), "offline-wiki-lore-wrapper-"));
    const linkedRoot = join(wrapper, "source");
    symlinkSync(fixture.sourceRoot, linkedRoot);
    expect(() => loadLocalLoreManifest(
      fixture.manifestPath,
      FIXTURE_RELEASE,
      linkedRoot,
    )).toThrow(/source root.*symlink/i);
  });

  it("rejects latest even when both manifest and caller request it", () => {
    const fixture = createFixture();
    writeManifest(fixture.manifestPath, { ...fixture.manifest, releaseId: "latest" });
    expect(() => loadLocalLoreManifest(
      fixture.manifestPath,
      "latest",
      fixture.sourceRoot,
    )).toThrow(/latest|4\.4/i);
  });

  it.each(["4.4-latest", "4.4-current", "4.4-ambiguous"])(
    "rejects unsupported ambiguous 4.4 release alias %s",
    (releaseId) => {
      const fixture = createFixture();
      writeManifest(fixture.manifestPath, { ...fixture.manifest, releaseId });
      expect(() => loadLocalLoreManifest(
        fixture.manifestPath,
        releaseId,
        fixture.sourceRoot,
      )).toThrow(/only supports|exact.*4\.4/i);
    },
  );

  it("does not exclude an unrelated file sharing the manifest path prefix", () => {
    const fixture = createFixture();
    writeFileSync(`${fixture.manifestPath}.backup`, "backup");
    expect(() => loadFixture(fixture)).toThrow(/undeclared/i);
  });

  it("accepts a canonical regular manifest outside sourceRoot", () => {
    const fixture = createFixture();
    const outsideRoot = mkdtempSync(join(tmpdir(), "offline-wiki-manifest-outside-"));
    const outsideManifest = join(outsideRoot, "manifest.json");
    writeManifest(outsideManifest, fixture.manifest);
    unlinkSync(fixture.manifestPath);

    expect(loadLocalLoreManifest(
      outsideManifest,
      FIXTURE_RELEASE,
      fixture.sourceRoot,
    )).toMatchObject(fixture.manifest);
  });

  it("rejects a manifest symlink even when the target is a canonical external file", () => {
    const fixture = createFixture();
    const outsideRoot = mkdtempSync(join(tmpdir(), "offline-wiki-manifest-outside-"));
    const outsideManifest = join(outsideRoot, "manifest.json");
    writeManifest(outsideManifest, fixture.manifest);

    const linkedManifest = join(fixture.sourceRoot, "linked-manifest.json");
    symlinkSync(outsideManifest, linkedManifest);
    expect(() => loadLocalLoreManifest(
      linkedManifest,
      FIXTURE_RELEASE,
      fixture.sourceRoot,
    )).toThrow(/manifest.*symlink/i);
  });

  it("rejects missing declared files rather than silently ignoring them", () => {
    const fixture = createFixture();
    writeManifest(fixture.manifestPath, {
      ...fixture.manifest,
      files: [{ ...fixture.manifest.files[0], path: "missing.jsonl" }],
    });
    expect(() => loadFixture(fixture)).toThrow(/missing|not found/i);
  });
});
