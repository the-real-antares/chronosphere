import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { PreviewCanvas } from './PreviewCanvas.tsx';
import type { ViewerMedia } from './media.ts';

/**
 * The expanded-view pan/zoom viewer (screens.md §5.3): drag-to-pan with
 * pointer capture, ×1.4 zoom steps clamped 0.5–4, − % + RESET overlay, a
 * source-hint caption chip (FULL RENDER / EMBEDDED PREVIEW / NO PREVIEW
 * AVAILABLE) and a corner hint. Pan/zoom state resets per map (resetKey).
 * The 140ms ease-out transform transition lives in CSS and is suspended
 * while dragging (.viewer.dragging).
 */

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 4;
const ZOOM_STEP = 1.4;

function clampZoom(z: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z));
}

const CAPTIONS: Record<Exclude<ViewerMedia['kind'], 'pending'>, string> = {
  render: 'FULL RENDER',
  embedded: 'EMBEDDED PREVIEW',
  none: 'NO PREVIEW AVAILABLE',
};

export function Viewer({
  media,
  onRenderError,
  resetKey,
}: {
  media: ViewerMedia;
  onRenderError: () => void;
  resetKey: string;
}) {
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ pointerId: number; startX: number; startY: number; baseX: number; baseY: number } | null>(null);

  // Viewer state resets per map.
  useEffect(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setDragging(false);
    drag.current = null;
  }, [resetKey]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, baseX: pan.x, baseY: pan.y };
    setDragging(true);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d === null || d.pointerId !== e.pointerId) return;
    setPan({ x: d.baseX + (e.clientX - d.startX), y: d.baseY + (e.clientY - d.startY) });
  };
  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d === null || d.pointerId !== e.pointerId) return;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    drag.current = null;
    setDragging(false);
  };

  const reset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  return (
    <div
      className={`viewer${dragging ? ' dragging' : ''}`}
      style={{ touchAction: 'none' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div
        className="viewer-canvas"
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
      >
        {media.kind === 'render' ? (
          <img
            src={media.url}
            alt=""
            draggable={false}
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
            onError={onRenderError}
          />
        ) : media.kind === 'embedded' ? (
          <PreviewCanvas data={media.data} style={{ position: 'absolute', inset: 0 }} />
        ) : media.kind === 'none' ? (
          <div className="thumb-placeholder" style={{ position: 'absolute', inset: 0 }} />
        ) : null}
      </div>
      {media.kind !== 'pending' ? <div className="viewer-caption">{CAPTIONS[media.kind]}</div> : null}
      {media.kind === 'render' || media.kind === 'embedded' ? (
        <div className="viewer-caption" style={{ top: 'auto', left: 'auto', bottom: 12, right: 12 }}>
          drag to pan
        </div>
      ) : null}
      <div className="zoom-bar" onPointerDown={(e) => e.stopPropagation()}>
        <button type="button" className="zoom-btn" title="Zoom out" onClick={() => setZoom((z) => clampZoom(z / ZOOM_STEP))}>
          −
        </button>
        <span className="zoom-pct">{Math.round(zoom * 100)}%</span>
        <button type="button" className="zoom-btn" title="Zoom in" onClick={() => setZoom((z) => clampZoom(z * ZOOM_STEP))}>
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
