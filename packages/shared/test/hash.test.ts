import { describe, expect, it } from 'vitest';
import { sha1Hex } from '../src/hash.ts';

describe('sha1Hex', () => {
  it('matches the known SHA-1 vector for "abc"', () => {
    expect(sha1Hex(new TextEncoder().encode('abc'))).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
  });

  it('matches the known SHA-1 vector for the empty input', () => {
    expect(sha1Hex(new Uint8Array(0))).toBe('da39a3ee5e6b4b0d3255bfef95601890afd80709');
  });

  it('is stable for identical bytes and differs on a one-byte change', () => {
    const a = Uint8Array.from([1, 2, 3, 4]);
    const b = Uint8Array.from([1, 2, 3, 5]);
    expect(sha1Hex(a)).toBe(sha1Hex(Uint8Array.from(a)));
    expect(sha1Hex(a)).not.toBe(sha1Hex(b));
  });
});
