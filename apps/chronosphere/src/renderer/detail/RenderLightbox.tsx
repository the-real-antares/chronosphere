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
/** Double-tap toggles between 1× and this, anchored at the tap point. */
const DOUBLE_TAP_ZOOM = 2.5;
/** A second touch-tap within this window (ms) counts as a double-tap. */
const DOUBLE_TAP_MS = 300;

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
  const [view, setViewState] = useState<View>({ zoom: 1, x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  // Synchronous mirror of `view` so rapid wheel/pinch events read fresh values.
  const viewRef = useRef<View>({ zoom: 1, x: 0, y: 0 });
  const commit = (v: View): void => {
    viewRef.current = v;
    setViewState(v);
  };
  const drag = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    baseX: number;
    baseY: number;
    moved: boolean;
  } | null>(null);
  // Active pointers by id — two of them means a pinch is in progress.
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  // Pinch baseline captured on the 1→2 transition (start distance + zoom).
  const pinch = useRef<{ d0: number; z0: number } | null>(null);
  // Last touch-tap time + a deferred-dismiss timer, so a single tap can still
  // close while a double-tap zooms instead.
  const lastTap = useRef(0);
  const dismissTimer = useRef<number | null>(null);

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

  // Clear any pending deferred-dismiss timer if we unmount first.
  useEffect(
    () => () => {
      if (dismissTimer.current !== null) window.clearTimeout(dismissTimer.current);
    },
    [],
  );

  const reset = (): void => commit({ zoom: 1, x: 0, y: 0 });

  // +/- buttons zoom toward the center (pan scales with the zoom ratio).
  const stepZoom = (factor: number): void => {
    const v = viewRef.current;
    const zoom = clampZoom(v.zoom * factor);
    const ratio = zoom / v.zoom;
    commit({ zoom, x: v.x * ratio, y: v.y * ratio });
  };

  // Anchored zoom: move to an absolute level while keeping the content under
  // (clientX, clientY) fixed. Shared by the wheel and the pinch handler.
  const zoomToPoint = (targetZoom: number, clientX: number, clientY: number): void => {
    const el = viewportRef.current;
    if (el === null) return;
    const rect = el.getBoundingClientRect();
    const cx = clientX - rect.left - rect.width / 2;
    const cy = clientY - rect.top - rect.height / 2;
    const v = viewRef.current;
    const zoom = clampZoom(targetZoom);
    const ratio = zoom / v.zoom;
    commit({ zoom, x: cx - ratio * (cx - v.x), y: cy - ratio * (cy - v.y) });
  };

  // Wheel zooms toward the cursor: keep the point under the pointer fixed.
  const onWheel = (e: ReactWheelEvent<HTMLDivElement>): void => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? WHEEL_STEP : 1 / WHEEL_STEP;
    zoomToPoint(viewRef.current.zoom * factor, e.clientX, e.clientY);
  };

  // Capture the pinch baseline (finger spread + zoom) from the two live pointers.
  const beginPinch = (): void => {
    const pts = [...pointers.current.values()];
    const a = pts[0];
    const b = pts[1];
    if (!a || !b) return;
    pinch.current = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, z0: viewRef.current.zoom };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // Second finger down: hand off from pan to pinch.
    if (pointers.current.size >= 2) {
      drag.current = null;
      beginPinch();
      setDragging(true);
      return;
    }
    drag.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      baseX: viewRef.current.x,
      baseY: viewRef.current.y,
      moved: false,
    };
    setDragging(true);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const p = pointers.current.get(e.pointerId);
    if (p) {
      p.x = e.clientX;
      p.y = e.clientY;
    }
    // Two fingers down: scale off the pinch baseline, anchored at the midpoint.
    if (pinch.current && pointers.current.size >= 2) {
      const pts = [...pointers.current.values()];
      const a = pts[0];
      const b = pts[1];
      if (a && b) {
        const d1 = Math.hypot(a.x - b.x, a.y - b.y);
        zoomToPoint(pinch.current.z0 * (d1 / pinch.current.d0), (a.x + b.x) / 2, (a.y + b.y) / 2);
      }
      return;
    }
    const d = drag.current;
    if (d === null || d.pointerId !== e.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.abs(dx) + Math.abs(dy) > CLICK_SLOP) d.moved = true;
    commit({ zoom: viewRef.current.zoom, x: d.baseX + dx, y: d.baseY + dy });
  };
  const endDrag = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!pointers.current.has(e.pointerId)) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    const released = drag.current;
    pointers.current.delete(e.pointerId);
    // Still ≥2 down (a third finger lifted): re-baseline the ongoing pinch.
    if (pointers.current.size >= 2) {
      beginPinch();
      return;
    }
    // 2→1: re-seat the pan baseline onto the surviving finger so it doesn't jump.
    if (pointers.current.size === 1) {
      pinch.current = null;
      const first = [...pointers.current.entries()][0];
      if (first) {
        const [id, pt] = first;
        drag.current = { pointerId: id, startX: pt.x, startY: pt.y, baseX: viewRef.current.x, baseY: viewRef.current.y, moved: true };
        setDragging(true);
      }
      return;
    }
    // Fully lifted.
    pinch.current = null;
    drag.current = null;
    setDragging(false);
    if (e.type !== 'pointerup' || released === null || released.pointerId !== e.pointerId || released.moved) return;
    // A clean, non-drag click/tap. Mouse dismisses immediately (backdrop-close).
    if (e.pointerType === 'mouse') {
      onClose();
      return;
    }
    // Touch: a second tap within the window zooms (anchored at the tap point);
    // otherwise defer the dismiss so a would-be double-tap isn't pre-empted.
    const now = e.timeStamp;
    if (now - lastTap.current < DOUBLE_TAP_MS) {
      lastTap.current = 0;
      if (dismissTimer.current !== null) {
        window.clearTimeout(dismissTimer.current);
        dismissTimer.current = null;
      }
      zoomToPoint(viewRef.current.zoom > 1.01 ? ZOOM_MIN : DOUBLE_TAP_ZOOM, e.clientX, e.clientY);
    } else {
      lastTap.current = now;
      dismissTimer.current = window.setTimeout(() => {
        dismissTimer.current = null;
        onClose();
      }, DOUBLE_TAP_MS);
    }
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
