import { useCallback, useEffect, useRef, useState } from 'react';

interface Opts {
  axis: 'x' | 'y';
  min: number;
  max: number;
  /** Invert the drag delta — e.g. a bottom-docked panel grows when dragged UP. */
  invert?: boolean;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/**
 * A localStorage-persisted resizable dimension + a `pointerdown` handler for a
 * drag grip (FileZilla/Termius-style splitters). Returns the current size and the
 * handler to attach to the grip element. Global pointer listeners run only while
 * dragging, and the body cursor/selection are locked for the duration.
 */
export function useResizable(key: string, defaultSize: number, opts: Opts) {
  const storageKey = `chrono.resize.${key}`;
  const [size, setSize] = useState<number>(() => {
    try {
      const n = Number(localStorage.getItem(storageKey));
      return Number.isFinite(n) && n > 0 ? clamp(n, opts.min, opts.max) : defaultSize;
    } catch {
      return defaultSize;
    }
  });

  const sizeRef = useRef(size);
  sizeRef.current = size;
  const optsRef = useRef(opts);
  optsRef.current = opts;

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, String(Math.round(size)));
    } catch {
      /* private mode / quota — resizing still works this session */
    }
  }, [storageKey, size]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    const o = optsRef.current;
    const startPos = o.axis === 'x' ? e.clientX : e.clientY;
    const startSize = sizeRef.current;
    const move = (ev: PointerEvent) => {
      const cur = o.axis === 'x' ? ev.clientX : ev.clientY;
      const delta = (cur - startPos) * (o.invert ? -1 : 1);
      setSize(clamp(startSize + delta, o.min, o.max));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = o.axis === 'x' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, []);

  return { size, onPointerDown };
}
