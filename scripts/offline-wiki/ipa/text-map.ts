export type DecodedTextMapEntry = {
  legacyHash: string;
  text: string;
  parameterized: boolean;
};

export type DecodedTextMap = {
  entries: Map<string, DecodedTextMapEntry>;
  primaryCount: number;
  indexCount: number;
};

class BinaryReader {
  private offset = 0;
  private readonly decoder = new TextDecoder("utf-8", { fatal: true });

  constructor(private readonly bytes: Uint8Array) {
    if (bytes.length > 2 && bytes[0] === 0) this.offset = 1;
  }

  get position(): number {
    return this.offset;
  }

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  unsigned(): bigint {
    let value = 0n;
    for (let shift = 0n; shift <= 63n; shift += 7n) {
      if (this.offset >= this.bytes.length) throw new Error("truncated TextMap varint");
      const byte = BigInt(this.bytes[this.offset++]!);
      value |= (byte & 0x7fn) << shift;
      if ((byte & 0x80n) === 0n) return value;
    }
    throw new Error("TextMap varint exceeds 64 bits");
  }

  signed(): bigint {
    const value = this.unsigned();
    return (value >> 1n) ^ -(value & 1n);
  }

  text(): string {
    const lengthValue = this.unsigned();
    if (lengthValue > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("TextMap string length is unsafe");
    const length = Number(lengthValue);
    if (length > this.remaining) throw new Error("truncated TextMap string");
    const slice = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    try {
      return this.decoder.decode(slice);
    } catch {
      throw new Error("TextMap contains invalid UTF-8");
    }
  }
}

function count(reader: BinaryReader, label: string): number {
  const value = reader.signed();
  if (value < 0n || value > 2_000_000n) throw new Error(`invalid ${label} count`);
  return Number(value);
}

export function decodeTextMap(bytes: Uint8Array): DecodedTextMap {
  const reader = new BinaryReader(bytes);
  const primaryCount = count(reader, "primary TextMap");
  const entries = new Map<string, DecodedTextMapEntry>();
  const orderedHashes: string[] = [];

  for (let index = 0; index < primaryCount; index += 1) {
    const mask = Number(reader.unsigned());
    if ((mask & 3) !== 3 || (mask & ~7) !== 0) throw new Error(`unsupported TextMap row mask ${mask}`);
    const legacyHash = reader.signed().toString();
    const hash = reader.unsigned().toString();
    const text = reader.text();
    const parameterizedValue = (mask & 4) === 0 ? 0n : reader.unsigned();
    if (parameterizedValue !== 0n && parameterizedValue !== 1n) {
      throw new Error("invalid TextMap parameter flag");
    }
    if (entries.has(hash)) throw new Error(`duplicate TextMap hash ${hash}`);
    entries.set(hash, { legacyHash, text, parameterized: parameterizedValue === 1n });
    orderedHashes.push(hash);
  }

  const indexCount = count(reader, "TextMap index");
  if (indexCount !== primaryCount) throw new Error("TextMap index count does not match primary count");
  for (let index = 0; index < indexCount; index += 1) {
    const mask = Number(reader.unsigned());
    if (mask !== 15) throw new Error(`unsupported TextMap index mask ${mask}`);
    const hash = reader.unsigned().toString();
    if (hash !== orderedHashes[index]) throw new Error(`TextMap index hash mismatch at row ${index}`);
    reader.unsigned();
    reader.unsigned();
    reader.unsigned();
  }
  if (reader.remaining !== 0) throw new Error(`TextMap has ${reader.remaining} trailing bytes`);

  return { entries, primaryCount, indexCount };
}
