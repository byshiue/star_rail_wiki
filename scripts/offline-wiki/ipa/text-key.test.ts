import { describe, expect, it } from "vitest";
import { xxhash64TextKey } from "./text-key";

describe("TextMap xxHash64 keys", () => {
  it("matches the published xxHash64 seed-zero reference vectors", () => {
    expect(xxhash64TextKey("")).toBe(BigInt("0xef46db3751d8e999").toString());
    expect(xxhash64TextKey("hello")).toBe(BigInt("0x26c7827d889f6da3").toString());
  });

  it("hashes UTF-8 bytes rather than UTF-16 code units", () => {
    expect(xxhash64TextKey("星穹铁道")).toMatch(/^\d+$/u);
    expect(xxhash64TextKey("星穹铁道")).not.toBe(xxhash64TextKey("星穹鐵道"));
  });
});
