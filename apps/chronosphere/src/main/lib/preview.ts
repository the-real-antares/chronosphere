import { promises as fs } from 'node:fs';
import { parseMapFile } from '@antares/shared/mapfile/parse.ts';
import { decodeEmbeddedPreview } from '@antares/shared/mapfile/preview.ts';
import type { PreviewData } from '../../ipc.ts';

/**
 * Embedded [PreviewPack] preview for a local map file. Best-effort by design:
 * any failure (missing file, unparseable map, undecodable pack) returns null.
 * The renderer draws the raw RGB via canvas putImageData — no PNG encoding.
 */
export async function getPreview(filePath: string): Promise<PreviewData | null> {
  try {
    const bytes = await fs.readFile(filePath);
    const parsed = parseMapFile(bytes);
    const decoded = decodeEmbeddedPreview(parsed);
    if (!decoded) return null;
    return {
      width: decoded.width,
      height: decoded.height,
      rgbBase64: Buffer.from(decoded.rgb.buffer, decoded.rgb.byteOffset, decoded.rgb.byteLength).toString('base64'),
    };
  } catch {
    return null;
  }
}
