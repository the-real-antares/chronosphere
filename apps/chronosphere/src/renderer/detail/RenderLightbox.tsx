import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { useViewerMedia } from './media.ts';

/**
 * Full-screen render lightbox (spec §4 imagery chain, "view full screen"): the
 * full-res render (renderUrl, 2048px) over a scrim, with wheel-to-zoom
 * (anchored at the cursor), drag-to-pan, a RESET, and three ways out — the ✕
 * button, Escape, or a non-drag click on the backdrop.
 *
 * Zoom/pan are pure CSS transforms (no libraries). The render is pulled through
 * the same persistent render-cache chain the expanded viewer uses (path=null,
 * so it only ever resolves the render or a graceful "couldn't load" state — the
 * caller only mounts this when a renderUrl actually exists).
 */

const ZOOM_MIN = 1;
const ZOOM_MAX = 8;
const WHEEL_STEP = 1.15;
const BUTTON_STEP = 1.4;
// A pointerup that moved less than this counts as a click (→ dismiss), not a pan.
const CLICK_SLOP = 5;

function clampZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

interface View {
  zoom: number;
  x: number;
  y: number;
}

export function RenderLightbox({
  renderUrl,
  cacheKey,
  name,
  onClose,
}: {
  /** Already-resolved full-res render URL (absolute or file:). */
  renderUrl: string | null;
  /** Render-cache key — the canonical version's content hash. */
  cacheKey: string | null;
  name: string;
  onClose: () => void;
}) {
  const { media } = useViewerMedia({ renderUrl, cacheKey, path: null });
  const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
    moved: boolean;
  } | null>(null);

  // Escape closes — capture phase so it wins over the global keyboard handler,
  // which would otherwise dock the expanded detail (or clear a selection) first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const reset = (): void => setView({ zoom: 1, x: 0, y: 0 });

  // +/- buttons zoom toward the center (pan scales with the zoom ratio).
  const stepZoom = (factor: number): void =>
    setView((v) => {
      const zoom = clampZoom(v.zoom * factor);
      const ratio = zoom / v.zoom;
      return { zoom, x: v.x * ratio, y: v.y * ratio };
    });

  // Wheel zooms toward the cursor: keep the point under the pointer fixed.
  const onWheel = (e: ReactWheelEvent<HTMLDivElement>): void => {
    e.preventDefault();
    const el = viewportRef.current;
    if (el === null) return;
    const rect = el.getBoundingClientRect();
    const cx = e.clientX - rect.left - rect.width / 2;
    const cy = e.clientY - rect.top - rect.height / 2;
    const factor = e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP;
    setView((v) => {
      const zoom = clampZoom(v.zoom * factor);
      const ratio = zoom / v.zoom;
      return { zoom, x: cx - ratio * (cx - v.x), y: cy - ratio * (cy - v.y) };
    });
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      baseX: view.x,
      baseY: view.y,
      moved: false,
    };
    setDragging(true);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (d === null || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) > CLICK_SLOP) d.moved = true;
    setView((v) => ({ ...v, x: d.baseX + dx, y: d.baseY + dy }));
  };
  const endDrag = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (d === null || d.pointerId !== e.pointerId) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const wasClick = !d.moved;
    drag.current = null;
    setDragging(false);
    // A click that didn't pan the image dismisses (backdrop-close).
    if (wasClick && e.type === 'pointerup') onClose();
  };

  const stop = (e: ReactPointerEvent<HTMLElement>): void => e.stopPropagation();

  return (
    <div
      className="render-lightbox"
      role="dialog"
      aria-modal="true"
      aria-label={`Full-screen render of ${name}`}
    >
      <button
        type="button"
        className="render-lightbox-close"
        aria-label="Close full-screen view"
        onPointerDown={stop}
        onClick={onClose}
      >
        ✕
      </button>
      <div
        ref={viewportRef}
        className={`render-lightbox-viewport${dragging ? ' dragging' : ''}`}
        style={{ touchAction: 'none' }}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div
          className="render-lightbox-canvas"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}
        >
          {media.kind === 'render' ? (
            <img
              className="render-lightbox-img"
              src={media.url}
              alt={`${name} — full render`}
              draggable={false}
            />
          ) : media.kind === 'pending' ? (
            <div className="render-lightbox-msg">Loading render…</div>
          ) : (
            <div className="render-lightbox-msg">Couldn’t load the render.</div>
          )}
        </div>
      </div>
      <div className="viewer-caption render-lightbox-caption">FULL RENDER</div>
      <div className="zoom-bar" onPointerDown={stop}>
        <button type="button" className="zoom-btn" title="Zoom out" onClick={() => stepZoom(1 / BUTTON_STEP)}>
          −
        </button>
        <span className="zoom-pct">{Math.round(view.zoom * 100)}%</span>
        <button type="button" className="zoom-btn" title="Zoom in" onClick={() => stepZoom(BUTTON_STEP)}>
          +
        </button>
        <span className="zoom-divider" />
        <button type="button" className="zoom-reset" onClick={reset}>
          RESET
        </button>
      </div>
    </div>
  );
}
