/**
 * LZO1X decompression, ported from the World-Altering Editor's C# MiniLZO
 * (src/TSMapEditor/Models/MapFormat/MiniLZO.cs, itself a port of minilzo 2.06),
 * plus a "stored" (literal-runs-only) compressor for map generation.
 *
 * One deliberate divergence from the WAE C# port: when a stream begins with a
 * short first-literal-run marker (first byte 18..20, i.e. fewer than 4 initial
 * literals), original minilzo copies the literals and then dispatches the next
 * byte as a *match* code. The WAE port instead falls back into its literal-run
 * dispatch loop, discarding that byte — it misreads streams that its own
 * compressor emits for inputs shorter than 4 bytes. We follow original minilzo
 * (which is also what the game itself uses), so such streams round-trip here.
 */

export class LzoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LzoError';
  }
}

/**
 * Decompress a raw lzo1x stream into exactly `expectedLength` bytes.
 * Throws LzoError on malformed input or when the stream does not decompress
 * to exactly the expected length (mirrors WAE's MiniLZO.Decompress check).
 */
export function lzo1xDecompress(src: Uint8Array, expectedLength: number): Uint8Array {
  if (!Number.isInteger(expectedLength) || expectedLength < 0) {
    throw new LzoError(`invalid expected length ${expectedLength}`);
  }
  const out = new Uint8Array(expectedLength);
  const inLen = src.length;
  let ip = 0; // input position
  let op = 0; // output position

  const fail = (msg: string): never => {
    throw new LzoError(`${msg} (input offset ${ip}, output offset ${op})`);
  };

  const readByte = (): number => {
    if (ip >= inLen) fail('unexpected end of input');
    return src[ip++]!;
  };

  const copyLiterals = (count: number): void => {
    if (ip + count > inLen) fail('literal run overruns input');
    if (op + count > expectedLength) fail('literal run overruns output');
    for (let i = 0; i < count; i++) out[op++] = src[ip++]!;
  };

  // Byte-wise forward copy — required for overlapping matches (LZO RLE).
  const copyMatch = (dist: number, count: number): void => {
    let from = op - dist;
    if (from < 0) fail('match reaches before output start');
    if (op + count > expectedLength) fail('match overruns output');
    for (let i = 0; i < count; i++) out[op++] = out[from++]!;
  };

  // Zero-extended count: each 0x00 adds 255, the final non-zero byte is added
  // to `base` (base is 15 for literal runs, 31 for M3 matches, 7 for M4).
  const readExtendedCount = (base: number): number => {
    let count = base;
    let b = readByte();
    while (b === 0) {
      count += 255;
      b = readByte();
    }
    return count + b;
  };

  const readU16le = (): number => {
    if (ip + 2 > inLen) fail('truncated match offset');
    const v = src[ip]! | (src[ip + 1]! << 8);
    ip += 2;
    return v;
  };

  type State = 'literal' | 'firstLiteralRun' | 'match' | 'matchDone';
  let state: State;
  let t = 0;

  if (inLen === 0) fail('empty stream');

  if (src[0]! > 17) {
    t = readByte() - 17;
    if (t < 4) {
      // Original-minilzo semantics (see the header comment): copy the short
      // initial run, then dispatch the next byte as a match code.
      copyLiterals(t);
      t = readByte();
      state = 'match';
    } else {
      copyLiterals(t);
      state = 'firstLiteralRun';
    }
  } else {
    state = 'literal';
  }

  decode: while (true) {
    switch (state) {
      case 'literal': {
        t = readByte();
        if (t >= 16) {
          state = 'match';
          break;
        }
        if (t === 0) t = readExtendedCount(15);
        copyLiterals(t + 3);
        state = 'firstLiteralRun';
        break;
      }

      case 'firstLiteralRun': {
        t = readByte();
        if (t >= 16) {
          state = 'match';
          break;
        }
        // M1 match directly after a literal run: length 3, distance 0x801..0x1400.
        copyMatch(0x801 + (t >> 2) + (readByte() << 2), 3);
        state = 'matchDone';
        break;
      }

      case 'match': {
        if (t >= 64) {
          // M2: length 3..8, distance 1..2048.
          const dist = 1 + ((t >> 2) & 7) + (readByte() << 3);
          copyMatch(dist, (t >> 5) + 1);
        } else if (t >= 32) {
          // M3: length 2 + (t & 31, zero-extended), distance 1..16384.
          let count = t & 31;
          if (count === 0) count = readExtendedCount(31);
          copyMatch(1 + (readU16le() >> 2), count + 2);
        } else if (t >= 16) {
          // M4: length 2 + (t & 7, zero-extended), distance 16385..49151;
          // distance bits of 0 mark the end-of-stream (16|1, 0, 0).
          let count = t & 7;
          if (count === 0) count = readExtendedCount(7);
          const distBits = ((t & 8) << 11) + (readU16le() >> 2);
          if (distBits === 0) break decode; // EOF marker
          copyMatch(distBits + 0x4000, count + 2);
        } else {
          // M1 after a match's trailing literals: length 2, distance 1..1024.
          copyMatch(1 + (t >> 2) + (readByte() << 2), 2);
        }
        state = 'matchDone';
        break;
      }

      case 'matchDone': {
        // The low 2 bits of the second-to-last consumed byte encode 0..3
        // trailing literals; after them the next byte is a match code.
        const trailing = src[ip - 2]! & 3;
        if (trailing === 0) {
          state = 'literal';
          break;
        }
        copyLiterals(trailing);
        t = readByte();
        state = 'match';
        break;
      }
    }
  }

  if (op !== expectedLength) {
    fail(`decompressed to ${op} bytes, expected ${expectedLength}`);
  }
  // Trailing input after the EOF marker is tolerated, like WAE (its Decompress
  // wrapper ignores the ip == ip_end return code and checks output length only).
  return out;
}

/**
 * Emit a valid lzo1x stream that stores `src` uncompressed, as literal runs
 * only. Decompressible by minilzo, the game, and lzo1xDecompress above.
 *
 * Layout: one literal-run header covering the whole input, the input bytes,
 * then the standard end-of-stream marker (16|1, 0, 0).
 * Inputs of 1..3 bytes need the short first-literal-run marker (17+len) — the
 * WAE C# MiniLZO port cannot read that case (see header comment), so callers
 * that care about WAE compatibility should avoid 1..3-byte chunks
 * (encodePackSection in packs.ts does).
 */
export function lzo1xCompressStored(src: Uint8Array): Uint8Array {
  const n = src.length;
  const header: number[] = [];

  if (n === 0) {
    // Just the end-of-stream marker.
    return Uint8Array.from([17, 0, 0]);
  } else if (n < 4) {
    // First-literal-run marker: first byte 17 + count.
    header.push(17 + n);
  } else if (n <= 18) {
    // Plain literal run code: count = code + 3.
    header.push(n - 3);
  } else {
    // Zero-extended literal run: count = 18 + 255*zeros + finalByte.
    const rem = n - 18;
    const zeros = Math.floor((rem - 1) / 255);
    const finalByte = rem - 255 * zeros;
    header.push(0);
    for (let i = 0; i < zeros; i++) header.push(0);
    header.push(finalByte);
  }

  const out = new Uint8Array(header.length + n + 3);
  out.set(header, 0);
  out.set(src, header.length);
  out.set([17, 0, 0], header.length + n); // EOF marker: M4 code 16|1, offset 0
  return out;
}
