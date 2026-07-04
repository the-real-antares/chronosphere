import { describe, expect, it } from 'vitest';
import { PackError, decodePackSection, encodePackSection } from '../src/mapfile/packs.ts';
import { seededBytes } from '../src/testing/fixtures.ts';

function linesToSection(lines: string[]): Record<string, string> {
  const section: Record<string, string> = {};
  lines.forEach((line, i) => {
    section[String(i + 1)] = line;
  });
  return section;
}

describe('encodePackSection → decodePackSection roundtrip', () => {
  const sizes = [0, 1, 5, 100, 1000, 8192, 8194, 20_000, 70_000];
  for (const size of sizes) {
    it(`roundtrips ${size} bytes`, () => {
      const data = seededBytes(size, 0xbead ^ size);
      const lines = encodePackSection(data);
      expect(decodePackSection(linesToSection(lines))).toEqual(data);
    });
  }

  it('emits no lines for empty data', () => {
    expect(encodePackSection(new Uint8Array(0))).toEqual([]);
    expect(decodePackSection({})).toEqual(new Uint8Array(0));
  });
});

describe('encodePackSection format details', () => {
  it('splits base64 into 70-char lines (all full except possibly the last)', () => {
    const lines = encodePackSection(seededBytes(20_000, 42));
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines.slice(0, -1)) expect(line).toHaveLength(70);
    const last = lines[lines.length - 1]!;
    expect(last.length).toBeGreaterThan(0);
    expect(last.length).toBeLessThanOrEqual(70);
    for (const line of lines) expect(line).toMatch(/^[A-Za-z0-9+/]+={0,2}$/);
  });

  it('writes u16 LE chunk headers (compressedSize, then uncompressedSize ≤ 8192)', () => {
    const data = seededBytes(20_000, 7);
    const bin = Buffer.from(encodePackSection(data).join(''), 'base64');
    let pos = 0;
    const uncompressedSizes: number[] = [];
    while (pos < bin.length) {
      const compressedSize = bin[pos]! | (bin[pos + 1]! << 8);
      const uncompressedSize = bin[pos + 2]! | (bin[pos + 3]! << 8);
      expect(compressedSize).toBeGreaterThan(0);
      expect(uncompressedSize).toBeGreaterThan(0);
      expect(uncompressedSize).toBeLessThanOrEqual(8192);
      uncompressedSizes.push(uncompressedSize);
      pos += 4 + compressedSize;
    }
    expect(pos).toBe(bin.length);
    expect(uncompressedSizes.reduce((a, b) => a + b, 0)).toBe(data.length);
  });

  it('never leaves a 1..3-byte tail chunk (WAE MiniLZO compatibility)', () => {
    for (const size of [8193, 8194, 8195, 16_385]) {
      const bin = Buffer.from(encodePackSection(seededBytes(size, size)).join(''), 'base64');
      let pos = 0;
      while (pos < bin.length) {
        const compressedSize = bin[pos]! | (bin[pos + 1]! << 8);
        const uncompressedSize = bin[pos + 2]! | (bin[pos + 3]! << 8);
        expect(uncompressedSize).toBeGreaterThanOrEqual(4);
        pos += 4 + compressedSize;
      }
    }
  });
});

describe('decodePackSection robustness', () => {
  it('joins lines in numeric key order', () => {
    const data = seededBytes(1000, 99);
    const lines = encodePackSection(data);
    expect(lines.length).toBeGreaterThanOrEqual(10); // crosses the '9'/'10' key boundary
    const section = linesToSection(lines);
    expect(decodePackSection(section)).toEqual(data);
  });

  it('rejects invalid base64', () => {
    expect(() => decodePackSection({ '1': 'not base64 !!!' })).toThrow(PackError);
    expect(() => decodePackSection({ '1': 'QUJ' })).toThrow(PackError); // not a multiple of 4
  });

  it('rejects a chunk header that overruns the section', () => {
    // compressedSize 0xffff with only 3 payload bytes present.
    const bogus = Buffer.from(Uint8Array.from([0xff, 0xff, 0x00, 0x20, 1, 2, 3])).toString('base64');
    expect(() => decodePackSection({ '1': bogus })).toThrow(PackError);
  });

  it('rejects a truncated chunk header', () => {
    const bogus = Buffer.from(Uint8Array.from([1, 0])).toString('base64');
    expect(() => decodePackSection({ '1': bogus })).toThrow(PackError);
  });

  it('rejects chunk data that is not valid lzo', () => {
    // Header: 4 compressed bytes → 100 uncompressed, but the payload is a
    // literal run that immediately overruns the input.
    const bogus = Buffer.from(Uint8Array.from([4, 0, 100, 0, 1, 9, 9, 9])).toString('base64');
    expect(() => decodePackSection({ '1': bogus })).toThrow(PackError);
  });
});
