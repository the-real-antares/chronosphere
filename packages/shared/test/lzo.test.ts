import { describe, expect, it } from 'vitest';
import { LzoError, lzo1xCompressStored, lzo1xDecompress } from '../src/mapfile/lzo.ts';
import { seededBytes } from '../src/testing/fixtures.ts';

describe('lzo1xCompressStored → lzo1xDecompress roundtrip', () => {
  const sizes = [0, 1, 2, 3, 4, 17, 18, 19, 255, 273, 274, 4096, 8191, 8192, 100_000];
  for (const size of sizes) {
    it(`roundtrips ${size} random bytes`, () => {
      const src = seededBytes(size, 0xc0ffee ^ size);
      const stream = lzo1xCompressStored(src);
      const back = lzo1xDecompress(stream, size);
      expect(back).toEqual(src);
    });
  }

  it('emits the bare end-of-stream marker for empty input', () => {
    expect(lzo1xCompressStored(new Uint8Array(0))).toEqual(Uint8Array.from([17, 0, 0]));
  });
});

describe('lzo1xDecompress on hand-crafted real-lzo streams', () => {
  it('decodes a literal run followed by an M2 match', () => {
    // [1] = literal run of 4, "abcd", M2 code 108 (len 4, dist 4), EOF.
    const stream = Uint8Array.from([1, 97, 98, 99, 100, 108, 0, 17, 0, 0]);
    expect(lzo1xDecompress(stream, 8)).toEqual(Uint8Array.from(Buffer.from('abcdabcd')));
  });

  it('decodes an M3 match with trailing literals', () => {
    // literal run "abcd", M3 code 33 (len 3), offset u16 13 (dist 4, 1 trailing
    // literal), trailing 'e', EOF → "abcdabce".
    const stream = Uint8Array.from([1, 97, 98, 99, 100, 33, 13, 0, 101, 17, 0, 0]);
    expect(lzo1xDecompress(stream, 8)).toEqual(Uint8Array.from(Buffer.from('abcdabce')));
  });

  it('decodes a short initial literal run + overlapping RLE match (WAE port divergence case)', () => {
    // First byte 18 = one initial literal 'x'; then M2 code 128 (len 5,
    // dist 1) — an overlapping RLE copy; EOF → "xxxxxx".
    const stream = Uint8Array.from([18, 120, 128, 0, 17, 0, 0]);
    expect(lzo1xDecompress(stream, 6)).toEqual(Uint8Array.from(Buffer.from('xxxxxx')));
  });
});

describe('lzo1xDecompress error handling', () => {
  it('rejects an empty stream', () => {
    expect(() => lzo1xDecompress(new Uint8Array(0), 0)).toThrow(LzoError);
  });

  it('rejects truncated streams', () => {
    const stream = lzo1xCompressStored(seededBytes(64, 7));
    expect(() => lzo1xDecompress(stream.subarray(0, 20), 64)).toThrow(LzoError);
  });

  it('rejects a stream that decompresses to the wrong length', () => {
    const stream = lzo1xCompressStored(seededBytes(10, 7));
    expect(() => lzo1xDecompress(stream, 11)).toThrow(LzoError);
    expect(() => lzo1xDecompress(stream, 9)).toThrow(LzoError);
  });

  it('rejects matches that reach before the output start', () => {
    // Literal run of 4, then M2 with distance 8 (> bytes written so far).
    const stream = Uint8Array.from([1, 1, 2, 3, 4, 108, 1, 17, 0, 0]);
    expect(() => lzo1xDecompress(stream, 32)).toThrow(LzoError);
  });
});
