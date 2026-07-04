/**
 * Embedded [PreviewPack] preview images.
 *
 * Pixel format per WAE MapWriter.WriteActualPreview: 3 bytes per pixel,
 * row-major, stored in the order R, G, B. (The WAE source carries a comment
 * claiming "BGR888", but the code stores Color.R first — we follow the code,
 * not the comment.)
 */
import type { ParsedMapFile } from './parse.ts';
import { decodePackSection, encodePackSection } from './packs.ts';

export interface DecodedPreview {
  width: number;
  height: number;
  /** 3 bytes/pixel (R, G, B), row-major. */
  rgb: Uint8Array;
}

/**
 * Best-effort decode of the embedded preview: null when the [Preview] size or
 * [PreviewPack] data is absent, undecodable, or too short for the declared
 * dimensions. Extra trailing bytes are tolerated.
 */
export function decodeEmbeddedPreview(parsed: ParsedMapFile): DecodedPreview | null {
  const size = parsed.previewSize;
  if (!size || !parsed.hasPreviewPack) return null;
  const section = parsed.ini.section('PreviewPack');
  if (!section) return null;

  let data: Uint8Array;
  try {
    data = decodePackSection(section);
  } catch {
    return null;
  }

  const needed = size.width * size.height * 3;
  if (needed <= 0 || data.length < needed) return null;

  return {
    width: size.width,
    height: size.height,
    rgb: data.length === needed ? data : data.slice(0, needed),
  };
}

/**
 * Build the [Preview] + [PreviewPack] section contents for a generated map.
 * `rgb` must be width*height*3 bytes (R, G, B per pixel, row-major).
 * The Size quad matches WAE MapWriter: `0,0,{width},{height}`.
 */
export function buildPreviewSections(
  rgb: Uint8Array,
  width: number,
  height: number,
): { preview: Record<string, string>; previewPack: string[] } {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
    throw new RangeError(`invalid preview dimensions ${width}x${height}`);
  }
  if (rgb.length !== width * height * 3) {
    throw new RangeError(
      `preview data is ${rgb.length} bytes, expected ${width * height * 3} for ${width}x${height}`,
    );
  }
  return {
    preview: { Size: `0,0,${width},${height}` },
    previewPack: encodePackSection(rgb),
  };
}
