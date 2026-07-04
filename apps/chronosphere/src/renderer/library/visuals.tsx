import { useEffect, useRef, useState } from 'react';
import type { PreviewData, ScannedFile } from '../../ipc.ts';
import { base64ToBytes } from '../api/client.ts';

/**
 * Shared row visuals for the Library panes: archive thumbnails (server
 * thumbnail URL → <img>, placeholder tile fallback), disk thumbnails
 * (embedded preview decoded from the local file via IPC → canvas), and
 * skeleton loading rows. Placeholders are a first-class state — never a
 * broken-image icon (spec §4.3).
 */

const THUMB_IMG_STYLE = {
  width: '100%',
  height: '100%',
  objectFit: 'cover',
  display: 'block',
} as const;

/** Archive-row thumbnail: /files thumbnail URL, or the hatched placeholder tile. */
export function ArchiveThumb({ url, alt }: { url: string | null; alt: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
  }, [url]);
  if (url === null || failed) {
    return <div className="row-thumb thumb-placeholder" aria-hidden="true" />;
  }
  return (
    <div className="row-thumb">
      <img src={url} alt={alt} loading="lazy" style={THUMB_IMG_STYLE} onError={() => setFailed(true)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Disk thumbnails — embedded preview via window.chrono.preview.getPreview.

const previewCache = new Map<string, PreviewData | null>();
const PREVIEW_CACHE_CAP = 800;

function previewKey(file: ScannedFile): string {
  return `${file.path}:${file.mtime}`;
}

/** Disk-row thumbnail: embedded preview decoded from the file on disk (canvas). */
export function DiskThumb({ file, small }: { file: ScannedFile; small?: boolean }) {
  const [preview, setPreview] = useState<PreviewData | null>(
    () => previewCache.get(previewKey(file)) ?? null,
  );
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const key = previewKey(file);
    if (previewCache.has(key)) {
      setPreview(previewCache.get(key) ?? null);
      return undefined;
    }
    if (!file.previewAvailable) {
      previewCache.set(key, null);
      setPreview(null);
      return undefined;
    }
    let alive = true;
    window.chrono.preview.getPreview(file.path).then(
      (data) => {
        if (previewCache.size >= PREVIEW_CACHE_CAP) previewCache.clear();
        previewCache.set(key, data);
        if (alive) setPreview(data);
      },
      () => {
        previewCache.set(key, null);
        if (alive) setPreview(null);
      },
    );
    return () => {
      alive = false;
    };
  }, [file]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || preview === null) return;
    canvas.width = preview.width;
    canvas.height = preview.height;
    const ctx = canvas.getContext('2d');
    if (ctx === null) return;
    const rgb = base64ToBytes(preview.rgbBase64);
    const image = ctx.createImageData(preview.width, preview.height);
    for (let src = 0, dst = 0; src + 2 < rgb.length && dst + 3 < image.data.length; src += 3, dst += 4) {
      image.data[dst] = rgb[src] ?? 0;
      image.data[dst + 1] = rgb[src + 1] ?? 0;
      image.data[dst + 2] = rgb[src + 2] ?? 0;
      image.data[dst + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }, [preview]);

  const cls = `row-thumb${small === true ? ' row-thumb-sm' : ''}`;
  if (preview === null) return <div className={`${cls} thumb-placeholder`} aria-hidden="true" />;
  return (
    <div className={cls}>
      <canvas ref={canvasRef} style={{ width: '100%', height: '100%', display: 'block' }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skeleton loading rows (DESIGN.md §12 — thumbnail block + text bars).

export function SkeletonRows({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div className="skeleton-row" key={i} aria-hidden="true">
          <div className="skeleton-block skeleton-thumb" />
          <div className="row-text">
            <div className="skeleton-block skeleton-line" style={{ width: `${42 + ((i * 13) % 32)}%` }} />
            <div
              className="skeleton-block skeleton-line"
              style={{ width: `${58 + ((i * 7) % 26)}%`, marginTop: 6 }}
            />
          </div>
        </div>
      ))}
    </>
  );
}
