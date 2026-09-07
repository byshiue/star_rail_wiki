import { existsSync, mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { publishAtomicOwner } from "./atomic-owner";

const parseOwner = (value: unknown): { pid: number; nonce: string } => value as { pid: number; nonce: string };
const owner = { pid: process.pid, nonce: "00000000-0000-4000-8000-000000000000" };

describe("atomic owner publication", () => {
  it("reports unsupported hard-link publication with an actionable diagnostic", () => {
    const directory = mkdtempSync(join(tmpdir(), "atomic-owner-"));
    const path = join(directory, "lock");
    const unsupported = Object.assign(new Error("unsupported"), { code: "EPERM" });
    expect(() => publishAtomicOwner({
      directory, path, label: "PDF build lock", value: owner, parse: parseOwner,
      operations: { publishOwnerLink: () => { throw unsupported; } },
    })).toThrow(/atomic hard-link publication.*local POSIX filesystem/i);
    expect(existsSync(path)).toBe(false);
  });

  it.each(["after-publish", "after-candidate-cleanup"] as const)(
    "cleans canonical and candidate owners when %s directory fsync fails",
    (phase) => {
      const directory = mkdtempSync(join(tmpdir(), "atomic-owner-"));
      const path = join(directory, "lock");
      const unsupported = Object.assign(new Error("unsupported"), { code: "ENOTSUP" });
      expect(() => publishAtomicOwner({
        directory, path, label: "PDF build lock", value: owner, parse: parseOwner,
        operations: {
          beforeOwnerDirectoryFsync: (_label, _path, currentPhase) => {
            if (currentPhase === phase) throw unsupported;
          },
        },
      })).toThrow(/directory fsync support.*local POSIX filesystem/i);
      expect(existsSync(path)).toBe(false);
      expect(readdirSync(directory).filter((name) => name.includes(".candidate-"))).toEqual([]);
    },
  );
});
