import { useEffect, useState } from 'react';
import type { PreviewData } from '../../ipc.ts';

/**
 * Imagery source resolution for the detail panel — the spec §4 three-step
 * chain, split per surface:
 *
 *   thumb (docked-compact): embedded preview → archive thumbnail → placeholder
 *   viewer (expanded):      full render (persistent cache → fetch) →
 *                           embedded preview → placeholder
 *
 * Never a broken image: <img> failures are reported back and drop the chain
 * to the next step.
 */

export type ThumbMedia =
  | { kind: 'pending' }
  | { kind: 'embedded'; data: PreviewData }
  | { kind: 'image'; url: string }
  | { kind: 'none' };

/** Embedded preview (IPC getPreview) → thumbnail URL → placeholder. */
export function useThumbMedia(path: string | null, thumbUrl: string | null): ThumbMedia {
  const [media, setMedia] = useState<ThumbMedia>({ kind: 'pending' });

  useEffect(() => {
    let live = true;
    const fallback: ThumbMedia = thumbUrl !== null ? { kind: 'image', url: thumbUrl } : { kind: 'none' };
    if (path === null) {
      setMedia(fallback);
      return undefined;
    }
    setMedia({ kind: 'pending' });
    void (async () => {
      let data: PreviewData | null = null;
      try {
        data = await window.chrono.preview.getPreview(path);
      } catch {
        data = null; // unreadable file — fall through the chain
      }
      if (!live) return;
      setMedia(data !== null ? { kind: 'embedded', data } : fallback);
    })();
    return () => {
      live = false;
    };
  }, [path, thumbUrl]);

  return media;
}

export type ViewerMedia =
  | { kind: 'pending' }
  | { kind: 'render'; url: string }
  | { kind: 'embedded'; data: PreviewData }
  | { kind: 'none' };

export interface ViewerMediaState {
  media: ViewerMedia;
  /** Call from an <img onError> to drop from the render to the fallback. */
  markRenderFailed: () => void;
}

/**
 * Full-res render via the persistent render cache (cached file → fetch+cache),
 * with embedded-preview and placeholder fallbacks.
 */
export function useViewerMedia(args: {
  renderUrl: string | null;
  /** Cache key — the canonical version's content hash. */
  cacheKey: string | null;
  /** Local file path for the embedded-preview fallback. */
  path: string | null;
}): ViewerMediaState {
  const { renderUrl, cacheKey, path } = args;
  const [media, setMedia] = useState<ViewerMedia>({ kind: 'pending' });
  const [renderFailed, setRenderFailed] = useState(false);

  useEffect(() => {
    setRenderFailed(false);
  }, [renderUrl, cacheKey]);

  useEffect(() => {
    let live = true;
    setMedia({ kind: 'pending' });
    void (async () => {
      if (!renderFailed && renderUrl !== null && cacheKey !== null) {
        try {
          const cached = await window.chrono.renderCache.getCached(cacheKey);
          const url = cached ?? (await window.chrono.renderCache.cacheRender(renderUrl, cacheKey));
          if (!live) return;
          setMedia({ kind: 'render', url });
          return;
        } catch {
          // offline / fetch failed — fall through to the embedded preview
        }
      }
      if (path !== null) {
        try {
          const data = await window.chrono.preview.getPreview(path);
          if (!live) return;
          if (data !== null) {
            setMedia({ kind: 'embedded', data });
            return;
          }
        } catch {
          // unreadable file — fall through to the placeholder
        }
      }
      if (live) setMedia({ kind: 'none' });
    })();
    return () => {
      live = false;
    };
  }, [renderUrl, cacheKey, path, renderFailed]);

  return { media, markRenderFailed: () => setRenderFailed(true) };
}
