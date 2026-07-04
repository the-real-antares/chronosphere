/**
 * The [IsoMapPack5]/[PreviewPack]/[OverlayPack] container format, ported from
 * the World-Altering Editor:
 *   - MapLoader.ReadIsoMapPack: indexed INI lines are concatenated, base64
 *     decoded, then read as a sequence of chunks
 *     { u16 LE compressedSize, u16 LE uncompressedSize, lzo1x data }.
 *   - MapWriter.GenerateLZOBlocksFromData: chunks hold at most 8192
 *     uncompressed bytes.
 *   - MapWriter.WriteBase64ToSection: base64 split into 70-char lines,
 *     keys indexed from 1.
 */
import { LzoError, lzo1xCompressStored, lzo1xDecompress } from './lzo.ts';

export class PackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PackError';
  }
}

/** WAE MapWriter.GenerateLZOBlocksFromData maxOutputSize. */
const MAX_CHUNK_UNCOMPRESSED = 8192;

/** WAE MapWriter.WriteBase64ToSection maxIsoMapPackEntryLineLength. */
const BASE64_LINE_LENGTH = 70;

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Decode a pack section (`Record` of indexed base64 lines) to its binary
 * payload. Lines are joined in ascending numeric key order (real files index
 * 1..N in order, so this matches WAE's join-in-section-order).
 * Throws PackError on invalid base64 or a malformed chunk stream.
 */
export function decodePackSection(section: Record<string, string>): Uint8Array {
  const keys = Object.keys(section).sort((a, b) => {
    const na = Number(a);
    const nb = Number(b);
    if (Number.isNaN(na) || Number.isNaN(nb)) return 0; // keep original order
    return na - nb;
  });

  let joined = '';
  for (const key of keys) joined += section[key] ?? '';

  if (joined.length === 0) return new Uint8Array(0);
  if (joined.length % 4 !== 0 || !BASE64_RE.test(joined)) {
    throw new PackError('pack section is not valid base64');
  }

  const bin = Buffer.from(joined, 'base64');
  const parts: Uint8Array[] = [];
  let total = 0;
  let pos = 0;

  while (pos < bin.length) {
    if (pos + 4 > bin.length) {
      throw new PackError(`truncated chunk header at offset ${pos}`);
    }
    const compressedSize = bin[pos]! | (bin[pos + 1]! << 8);
    const uncompressedSize = bin[pos + 2]! | (bin[pos + 3]! << 8);
    pos += 4;

    // Format5.DecodeInto stops on a zero-size chunk; treat it as a terminator.
    if (compressedSize === 0 && uncompressedSize === 0) break;
    if (compressedSize === 0 || uncompressedSize === 0) {
      throw new PackError(`invalid chunk header at offset ${pos - 4}`);
    }
    // WAE MapLoader: position + inputSize + 4 > length → invalid.
    if (pos + compressedSize > bin.length) {
      throw new PackError(`chunk data overruns section at offset ${pos - 4}`);
    }

    let chunk: Uint8Array;
    try {
      chunk = lzo1xDecompress(bin.subarray(pos, pos + compressedSize), uncompressedSize);
    } catch (err) {
      if (err instanceof LzoError) throw new PackError(`chunk failed to decompress: ${err.message}`);
      throw err;
    }
    parts.push(chunk);
    total += chunk.length;
    pos += compressedSize;
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

/**
 * Encode binary data as pack-section lines: chunk (≤8192 uncompressed) →
 * lzo1xCompressStored → { u16 LE compressedSize, u16 LE uncompressedSize }
 * headers → concat → base64 split into 70-char lines. The caller assigns the
 * 1-based keys.
 *
 * Chunking never leaves a 1..3-byte tail (the previous chunk is shortened
 * instead) so that every emitted lzo stream is also readable by WAE's C#
 * MiniLZO port — see lzo.ts for the divergence it has on tiny streams.
 */
export function encodePackSection(data: Uint8Array): string[] {
  const blocks: Uint8Array[] = [];
  let totalLength = 0;
  let pos = 0;

  while (pos < data.length) {
    let take = Math.min(data.length - pos, MAX_CHUNK_UNCOMPRESSED);
    const remainderAfter = data.length - pos - take;
    if (remainderAfter > 0 && remainderAfter < 4) take -= 4 - remainderAfter;

    const compressed = lzo1xCompressStored(data.subarray(pos, pos + take));
    if (compressed.length > 0xffff) {
      throw new PackError('compressed chunk exceeds the u16 header limit'); // unreachable with 8192-byte chunks
    }

    const block = new Uint8Array(4 + compressed.length);
    block[0] = compressed.length & 0xff;
    block[1] = (compressed.length >> 8) & 0xff;
    block[2] = take & 0xff;
    block[3] = (take >> 8) & 0xff;
    block.set(compressed, 4);
    blocks.push(block);
    totalLength += block.length;
    pos += take;
  }

  const all = new Uint8Array(totalLength);
  let offset = 0;
  for (const block of blocks) {
    all.set(block, offset);
    offset += block.length;
  }

  const base64 = Buffer.from(all).toString('base64');
  const lines: string[] = [];
  for (let i = 0; i < base64.length; i += BASE64_LINE_LENGTH) {
    lines.push(base64.slice(i, i + BASE64_LINE_LENGTH));
  }
  return lines;
}
