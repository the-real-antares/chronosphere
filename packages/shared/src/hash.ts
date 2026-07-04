import { createHash } from 'node:crypto';

/**
 * SHA-1 over the raw file bytes — the CnCNet-compatible content hash used as
 * the identity/dedup key everywhere. Never derived from the in-file [Digest].
 */
export function sha1Hex(bytes: Uint8Array): string {
  return createHash('sha1').update(bytes).digest('hex');
}
