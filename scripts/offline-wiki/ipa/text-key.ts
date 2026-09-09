const MASK = (1n << 64n) - 1n;
const PRIME1 = 11_400_714_785_074_694_791n;
const PRIME2 = 14_029_467_366_897_019_727n;
const PRIME3 = 1_609_587_929_392_839_161n;
const PRIME4 = 9_650_029_242_287_828_579n;
const PRIME5 = 2_870_177_450_012_600_261n;

function add(...values: bigint[]): bigint {
  return values.reduce((sum, value) => (sum + value) & MASK, 0n);
}

function multiply(left: bigint, right: bigint): bigint {
  return (left * right) & MASK;
}

function rotateLeft(value: bigint, bits: bigint): bigint {
  return ((value << bits) | (value >> (64n - bits))) & MASK;
}

function read64(bytes: Uint8Array, offset: number): bigint {
  let value = 0n;
  for (let index = 0; index < 8; index += 1) value |= BigInt(bytes[offset + index]!) << BigInt(index * 8);
  return value;
}

function read32(bytes: Uint8Array, offset: number): bigint {
  return BigInt(bytes[offset]!)
    | (BigInt(bytes[offset + 1]!) << 8n)
    | (BigInt(bytes[offset + 2]!) << 16n)
    | (BigInt(bytes[offset + 3]!) << 24n);
}

function round(accumulator: bigint, input: bigint): bigint {
  return multiply(rotateLeft(add(accumulator, multiply(input, PRIME2)), 31n), PRIME1);
}

function mergeRound(accumulator: bigint, value: bigint): bigint {
  return add(multiply(accumulator ^ round(0n, value), PRIME1), PRIME4);
}

export function xxhash64TextKey(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let offset = 0;
  let hash: bigint;
  if (bytes.length >= 32) {
    let value1 = add(PRIME1, PRIME2);
    let value2 = PRIME2;
    let value3 = 0n;
    let value4 = add(-PRIME1);
    const limit = bytes.length - 32;
    while (offset <= limit) {
      value1 = round(value1, read64(bytes, offset)); offset += 8;
      value2 = round(value2, read64(bytes, offset)); offset += 8;
      value3 = round(value3, read64(bytes, offset)); offset += 8;
      value4 = round(value4, read64(bytes, offset)); offset += 8;
    }
    hash = add(rotateLeft(value1, 1n), rotateLeft(value2, 7n), rotateLeft(value3, 12n), rotateLeft(value4, 18n));
    hash = mergeRound(hash, value1);
    hash = mergeRound(hash, value2);
    hash = mergeRound(hash, value3);
    hash = mergeRound(hash, value4);
  } else {
    hash = PRIME5;
  }
  hash = add(hash, BigInt(bytes.length));
  while (offset + 8 <= bytes.length) {
    const lane = round(0n, read64(bytes, offset));
    hash = multiply(rotateLeft(hash ^ lane, 27n), PRIME1);
    hash = add(hash, PRIME4);
    offset += 8;
  }
  if (offset + 4 <= bytes.length) {
    hash ^= multiply(read32(bytes, offset), PRIME1);
    hash = add(multiply(rotateLeft(hash, 23n), PRIME2), PRIME3);
    offset += 4;
  }
  while (offset < bytes.length) {
    hash ^= multiply(BigInt(bytes[offset]!), PRIME5);
    hash = multiply(rotateLeft(hash, 11n), PRIME1);
    offset += 1;
  }
  hash ^= hash >> 33n;
  hash = multiply(hash, PRIME2);
  hash ^= hash >> 29n;
  hash = multiply(hash, PRIME3);
  hash ^= hash >> 32n;
  return (hash & MASK).toString();
}
