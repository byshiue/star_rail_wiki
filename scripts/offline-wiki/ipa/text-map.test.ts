import { describe, expect, it } from "vitest";
import { decodeTextMap } from "./text-map";

function unsigned(value: bigint): Buffer {
  const bytes: number[] = [];
  let remaining = value;
  do {
    let byte = Number(remaining & 0x7fn);
    remaining >>= 7n;
    if (remaining) byte |= 0x80;
    bytes.push(byte);
  } while (remaining);
  return Buffer.from(bytes);
}

function signed(value: bigint): Buffer {
  return unsigned((value << 1n) ^ (value >> 63n));
}

function fixture(rows: Array<{ legacy: bigint; hash: bigint; text: string; parameterized?: boolean }>): Buffer {
  const primary = rows.flatMap((row) => {
    const text = Buffer.from(row.text, "utf8");
    return [
      unsigned(BigInt(row.parameterized ? 7 : 3)),
      signed(row.legacy),
      unsigned(row.hash),
      unsigned(BigInt(text.byteLength)),
      text,
      ...(row.parameterized ? [unsigned(1n)] : []),
    ];
  });
  const index = rows.flatMap((row, position) => [
    unsigned(15n),
    unsigned(row.hash),
    unsigned(BigInt(position)),
    unsigned(BigInt(Buffer.byteLength(row.text, "utf8"))),
    unsigned(row.parameterized ? 1n : 0n),
  ]);
  return Buffer.concat([signed(BigInt(rows.length)), ...primary, signed(BigInt(rows.length)), ...index]);
}

describe("4.5 IPA TextMap decoder", () => {
  it("decodes every primary row and consumes its matching trailing index", () => {
    const decoded = decodeTextMap(fixture([
      { legacy: -7n, hash: 14669713281277919926n, text: "攻击力" },
      { legacy: 9n, hash: 17153391889370378182n, text: "角色故事·一", parameterized: true },
    ]));

    expect(decoded.entries).toEqual(new Map([
      ["14669713281277919926", { legacyHash: "-7", text: "攻击力", parameterized: false }],
      ["17153391889370378182", { legacyHash: "9", text: "角色故事·一", parameterized: true }],
    ]));
    expect(decoded.primaryCount).toBe(2);
    expect(decoded.indexCount).toBe(2);
  });

  it("rejects truncation instead of returning partial prose", () => {
    const bytes = fixture([{ legacy: 1n, hash: 2n, text: "完整正文" }]);
    expect(() => decodeTextMap(bytes.subarray(0, bytes.length - 1))).toThrow(/truncated/i);
  });

  it("rejects invalid UTF-8 instead of inserting replacement characters", () => {
    const bytes = fixture([{ legacy: 1n, hash: 2n, text: "x" }]);
    const textOffset = 5;
    bytes[textOffset] = 0xff;
    expect(() => decodeTextMap(bytes)).toThrow(/UTF-8/i);
  });

  it("rejects duplicate modern hashes and unsupported masks", () => {
    expect(() => decodeTextMap(fixture([
      { legacy: 1n, hash: 2n, text: "甲" },
      { legacy: 3n, hash: 2n, text: "乙" },
    ]))).toThrow(/duplicate/i);

    const bytes = fixture([{ legacy: 1n, hash: 2n, text: "甲" }]);
    bytes[1] = 11;
    expect(() => decodeTextMap(bytes)).toThrow(/mask/i);
  });

  it("rejects a trailing index that does not bind to the primary row", () => {
    const bytes = fixture([{ legacy: 1n, hash: 2n, text: "甲" }]);
    const trailingHashOffset = bytes.length - 4;
    bytes[trailingHashOffset] = 3;
    expect(() => decodeTextMap(bytes)).toThrow(/index hash/i);
  });
});
