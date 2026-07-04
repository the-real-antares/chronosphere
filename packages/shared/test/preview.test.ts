import { describe, expect, it } from 'vitest';
import { buildPreviewSections, decodeEmbeddedPreview } from '../src/mapfile/preview.ts';
import { parseMapFile } from '../src/mapfile/parse.ts';
import { seededBytes } from '../src/testing/fixtures.ts';

function iniBytes(text: string): Uint8Array {
  return Uint8Array.from(Buffer.from(text, 'latin1'));
}

function assembleMinimalMap(preview: Record<string, string>, previewPack: string[]): Uint8Array {
  const lines: string[] = ['[Preview]'];
  for (const [key, value] of Object.entries(preview)) lines.push(`${key}=${value}`);
  lines.push('', '[PreviewPack]');
  previewPack.forEach((line, i) => lines.push(`${i + 1}=${line}`));
  lines.push('', '[Basic]', 'Name=Preview Roundtrip', '');
  return iniBytes(lines.join('\r\n'));
}

describe('buildPreviewSections → parseMapFile → decodeEmbeddedPreview', () => {
  it('roundtrips pixels exactly', () => {
    const width = 24;
    const height = 16;
    const rgb = seededBytes(width * height * 3, 0xfeed);

    const { preview, previewPack } = buildPreviewSections(rgb, width, height);
    expect(preview['Size']).toBe('0,0,24,16');

    const parsed = parseMapFile(assembleMinimalMap(preview, previewPack));
    expect(parsed.previewSize).toEqual({ width, height });
    expect(parsed.hasPreviewPack).toBe(true);

    const decoded = decodeEmbeddedPreview(parsed);
    expect(decoded).not.toBeNull();
    expect(decoded!.width).toBe(width);
    expect(decoded!.height).toBe(height);
    expect(decoded!.rgb).toEqual(rgb);
  });

  it('roundtrips a preview large enough for multiple lzo chunks', () => {
    const width = 106;
    const height = 61;
    const rgb = seededBytes(width * height * 3, 0xd00d); // 19398 bytes → 3 chunks

    const { preview, previewPack } = buildPreviewSections(rgb, width, height);
    const decoded = decodeEmbeddedPreview(parseMapFile(assembleMinimalMap(preview, previewPack)));
    expect(decoded!.rgb).toEqual(rgb);
  });

  it('rejects rgb data that does not match the dimensions', () => {
    expect(() => buildPreviewSections(new Uint8Array(10), 2, 2)).toThrow(RangeError);
    expect(() => buildPreviewSections(new Uint8Array(0), 0, 0)).toThrow(RangeError);
  });
});

describe('decodeEmbeddedPreview best-effort nulls', () => {
  it('returns null when there is no [PreviewPack]', () => {
    const parsed = parseMapFile(iniBytes('[Preview]\nSize=0,0,4,4\n[Basic]\nName=x\n'));
    expect(decodeEmbeddedPreview(parsed)).toBeNull();
  });

  it('returns null when there is no [Preview] size', () => {
    const { previewPack } = buildPreviewSections(seededBytes(48, 1), 4, 4);
    const lines = ['[PreviewPack]', ...previewPack.map((l, i) => `${i + 1}=${l}`), '[Basic]', 'Name=x'];
    const parsed = parseMapFile(iniBytes(lines.join('\n')));
    expect(decodeEmbeddedPreview(parsed)).toBeNull();
  });

  it('returns null when the declared size exceeds the decoded data', () => {
    const { previewPack } = buildPreviewSections(seededBytes(12, 2), 2, 2);
    const lines = [
      '[Preview]',
      'Size=0,0,4,4', // lies: pack only holds 2x2
      '[PreviewPack]',
      ...previewPack.map((l, i) => `${i + 1}=${l}`),
    ];
    const parsed = parseMapFile(iniBytes(lines.join('\n')));
    expect(decodeEmbeddedPreview(parsed)).toBeNull();
  });

  it('returns null when the pack data is undecodable', () => {
    const parsed = parseMapFile(
      iniBytes('[Preview]\nSize=0,0,4,4\n[PreviewPack]\n1=////AAAA\n[Basic]\nName=x\n'),
    );
    expect(decodeEmbeddedPreview(parsed)).toBeNull();
  });
});
