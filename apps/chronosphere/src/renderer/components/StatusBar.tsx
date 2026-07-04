import { useAppState, useActions, type DiskStatusFilter } from '../state/store.tsx';

/**
 * Status bar (screens.md §2.2) — six segments wired as the disk pane's status
 * filter; counts from reconcile (two-axis rule: membership counts sum to the
 * total; broken/dup are separate indicators). Right side: activity toggle.
 */

interface Segment {
  key: DiskStatusFilter;
  className: string;
  glyph: string;
  label: string;
  count: (c: { total: number; known: number; unknown: number; update: number; broken: number; dup: number }) => number;
}

const SEGMENTS: Segment[] = [
  { key: 'all', className: 'seg-all', glyph: '', label: 'maps', count: (c) => c.total },
  { key: 'known', className: 'seg-known', glyph: '✓', label: 'known', count: (c) => c.known },
  { key: 'unknown', className: 'seg-unknown', glyph: '✦', label: 'unknown', count: (c) => c.unknown },
  { key: 'update', className: 'seg-update', glyph: '↑', label: 'update', count: (c) => c.update },
  { key: 'broken', className: 'seg-broken', glyph: '⚠', label: 'broken', count: (c) => c.broken },
  { key: 'dup', className: 'seg-dup', glyph: '⧉', label: 'dup', count: (c) => c.dup },
];

export function StatusBar() {
  const state = useAppState();
  const actions = useActions();
  const counts = state.disk.counts;
  const active = state.disk.filters.status;

  return (
    <div className="statusbar">
      {SEGMENTS.map((seg) => (
        <button
          key={seg.key}
          type="button"
          className={`statusbar-seg ${seg.className}${active === seg.key ? ' active' : ''}`}
          onClick={() => actions.setDiskStatusFilter(seg.key)}
        >
          <span className="seg-label">
            {seg.glyph ? `${seg.glyph} ` : ''}
            {seg.label}
          </span>
          <span className="seg-count">{seg.count(counts)}</span>
        </button>
      ))}
      <div className="statusbar-spacer" />
      <div className="statusbar-right">
        <button
          type="button"
          className="chrome-btn"
          title="Activity log"
          onClick={() => actions.toggleActivityDrawer()}
        >
          ⟲ Activity
        </button>
      </div>
    </div>
  );
}
