import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { healthChipLabel } from '../lib/format.ts';
import { useStore, type ChronoshiftRequest } from '../state/store.tsx';
import { ModalHeader, ModalShell } from './common.tsx';

/**
 * Chronoshift surfaces (screens.md §6, reconciliation #4/#6):
 * - the flying ghost (42×42, cs-fly, skipped under reduced motion),
 * - the bottom-center progress chip with real per-item + overall progress,
 * - the batch partial-failure summary,
 * - the broken-map replace confirm ("SWAP IT"), requested via
 *   requestSwapConfirm() from anywhere (the detail agent's Replace action).
 */

export const SWAP_CONFIRM_EVENT = 'chronosphere:swap-confirm';

/** Ask the user to confirm replacing a broken map with the verified copy. */
export function requestSwapConfirm(request: ChronoshiftRequest): void {
  window.dispatchEvent(new CustomEvent<ChronoshiftRequest>(SWAP_CONFIRM_EVENT, { detail: request }));
}

interface GhostSpec {
  key: number;
  left: number;
  top: number;
  dx: number;
  dy: number;
}

const ellipsis = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const;

export function ChronoshiftLayer() {
  const { state, actions } = useStore();
  const { running, items, summary } = state.chronoshift;

  // --- ghost -----------------------------------------------------------------
  const [ghost, setGhost] = useState<GhostSpec | null>(null);
  const prevRunning = useRef(false);
  const reducedMotion = state.settings?.reducedMotion ?? false;

  useEffect(() => {
    if (running && !prevRunning.current) {
      const osReduced =
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const first = items[0];
      if (!reducedMotion && !osReduced && items.length === 1 && first !== undefined) {
        const source = document.querySelector(`[data-arc="${CSS.escape(first.slug)}"]`);
        const target = document.querySelector('[data-disk-head]');
        if (source !== null && target !== null) {
          const s = source.getBoundingClientRect();
          const t = target.getBoundingClientRect();
          const left = s.left + 16;
          const top = s.top + (s.height - 42) / 2;
          const dx = t.left + 16 - left;
          const dy = t.top + (t.height - 42) / 2 - top;
          const spec: GhostSpec = { key: Date.now(), left, top, dx, dy };
          setGhost(spec);
          window.setTimeout(() => {
            setGhost((cur) => (cur !== null && cur.key === spec.key ? null : cur));
          }, 620);
        }
      }
    }
    prevRunning.current = running;
  }, [running, items, reducedMotion]);

  // --- swap confirm ------------------------------------------------------------
  const [swap, setSwap] = useState<ChronoshiftRequest | null>(null);

  useEffect(() => {
    const onRequest = (e: Event): void => {
      const detail = (e as CustomEvent<ChronoshiftRequest>).detail;
      if (detail !== undefined && detail !== null && typeof detail.slug === 'string') {
        setSwap(detail);
      }
    };
    window.addEventListener(SWAP_CONFIRM_EVENT, onRequest);
    return () => window.removeEventListener(SWAP_CONFIRM_EVENT, onRequest);
  }, []);

  useEffect(() => {
    if (swap === null) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setSwap(null);
      } else if (e.key === 'Enter') {
        e.stopPropagation();
        confirmSwapRef.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [swap]);

  const confirmSwap = (): void => {
    if (swap === null) return;
    actions.pushToast({ kind: 'info', glyph: '⟳', title: 'Swapping in a verified copy…', sub: swap.name });
    void actions.chronoshift([swap]);
    setSwap(null);
  };
  const confirmSwapRef = useRef(confirmSwap);
  confirmSwapRef.current = confirmSwap;

  // Esc dismisses the batch summary before the app-level Esc cascade runs.
  const summaryShown = summary !== null && summary.total > 1 && !running;
  useEffect(() => {
    if (!summaryShown) return undefined;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        actions.clearChronoshiftSummary();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [summaryShown, actions]);

  // --- progress chip derived values ----------------------------------------------
  const overall =
    items.length > 0 ? Math.round(items.reduce((sum, i) => sum + i.pct, 0) / items.length) : 0;
  const current =
    items.find((i) => i.status === 'downloading' || i.status === 'verifying') ??
    items.find((i) => i.status === 'pending') ??
    items[items.length - 1];
  const finished = items.filter((i) => i.status === 'done' || i.status === 'failed').length;
  const phase =
    current !== undefined && current.status === 'verifying'
      ? 'Re-verifying locally…'
      : 'Chronoshifting…';

  return (
    <>
      {ghost !== null ? (
        <div
          key={ghost.key}
          className="chrono-ghost thumb-placeholder"
          style={{
            left: ghost.left,
            top: ghost.top,
            ...({ '--dx': `${ghost.dx}px`, '--dy': `${ghost.dy}px` } as CSSProperties),
          }}
          aria-hidden="true"
        />
      ) : null}

      {running && items.length > 0 ? (
        <div className="chrono-chip" role="status">
          <div className="chrono-chip-head">
            <span className="chrono-chip-glyph">⟳</span>
            <span className="chrono-chip-phase">{phase}</span>
            <span className="chrono-chip-pct">{overall}%</span>
          </div>
          <div className="chrono-chip-track">
            <div className="chrono-chip-fill" style={{ width: `${overall}%` }} />
          </div>
          {items.length === 1 ? (
            <div className="chrono-chip-sub">{items[0]?.name ?? ''}</div>
          ) : (
            <>
              <div className="chrono-chip-sub">
                {Math.min(finished + 1, items.length)} of {items.length}
                {current !== undefined ? ` · ${current.name}` : ''}
              </div>
              <div style={{ maxHeight: 110, overflowY: 'auto', marginTop: 6 }}>
                {items.map((item) => (
                  <div key={item.key} className="progress-row" style={{ fontSize: 11, padding: '3px 0' }}>
                    <span style={{ flex: '0 0 45%', ...ellipsis }}>{item.name}</span>
                    <div className="progress-track">
                      <div className="progress-fill" style={{ width: `${item.pct}%` }} />
                    </div>
                    <span
                      style={{ width: 32, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                      className={
                        item.status === 'failed' ? 'status-err' : item.status === 'done' ? 'status-ok' : ''
                      }
                    >
                      {item.status === 'failed' ? '✕' : item.status === 'done' ? '✓' : `${item.pct}%`}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      ) : null}

      {summaryShown && summary !== null ? (
        <ModalShell className="modal-tidy" onClose={() => actions.clearChronoshiftSummary()}>
          <ModalHeader onClose={() => actions.clearChronoshiftSummary()}>
            <span className="modal-title">⟳ Chronoshift summary</span>
          </ModalHeader>
          <div className="modal-body">
            <div className="onb-body-sm" style={{ marginBottom: 10 }}>
              Chronoshifted {summary.succeeded} of {summary.total} maps.{' '}
              {summary.failed.length} failed — nothing was destroyed.
            </div>
            {items.map((item) => (
              <div key={item.key} className="progress-row" title={item.error ?? ''}>
                <span className={item.status === 'done' ? 'status-ok' : 'status-err'}>
                  {item.status === 'done' ? '✓' : '⚠'}
                </span>
                <span style={{ flex: 1, ...ellipsis }}>{item.name}</span>
                <span className="row-meta" style={{ maxWidth: '45%', ...ellipsis }}>
                  {item.status === 'done'
                    ? item.verdict !== null
                      ? `re-verified ${healthChipLabel(item.verdict)}`
                      : 'installed'
                    : (item.error ?? 'failed')}
                </span>
              </div>
            ))}
          </div>
          <div className="modal-footer">
            <span className="modal-footer-spacer" />
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => actions.clearChronoshiftSummary()}
            >
              Done
            </button>
          </div>
        </ModalShell>
      ) : null}

      {swap !== null ? (
        <ModalShell className="modal-review" onClose={() => setSwap(null)}>
          <div className="modal-body" style={{ padding: '22px 20px 8px' }}>
            <div className="pane-state-title" style={{ marginBottom: 6 }}>
              This one’s broken. There’s a verified copy — swap it?
            </div>
            <div className="onb-body-sm">
              {swap.name} — the archive’s verified copy replaces the broken file on disk.
            </div>
          </div>
          <div className="modal-footer">
            <span className="modal-footer-spacer" />
            <button type="button" className="btn btn-ghost" onClick={() => setSwap(null)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={confirmSwap}>
              SWAP IT
            </button>
          </div>
        </ModalShell>
      ) : null}
    </>
  );
}
