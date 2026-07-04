import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HEALTH_GLYPHS, type HealthVerdict } from '@antares/shared/taxonomy.ts';
import type { ScannedFile } from '../../ipc.ts';
import { requestSwapConfirm } from '../flows/ChronoshiftLayer.tsx';
import { NewMapsBanner } from '../flows/PaneStates.tsx';
import { diskMetaLine, formatCount, healthWord, playersLabel } from '../lib/format.ts';
import type { DiskRow, DiskSubRow, Membership } from '../lib/types.ts';
import { shouldNudge, useStore, type DiskSort, type DiskStatusFilter } from '../state/store.tsx';
import { hasMapDrag, readMapDrag } from './dnd.ts';
import { DiskThumb, SkeletonRows } from './visuals.tsx';

/**
 * The Your-Disk pane (screens.md §4): reconciled rows with the TWO-AXIS
 * anatomy (membership badge + health chip, glyph-first, never color alone),
 * version-group / duplicate-group disclosure sub-rows, per-row contextual
 * quick actions (DESIGN.md §5 matrix), the review nudge (reconciliation #7),
 * scan progress strip, "N new maps found" banner, and the HTML5 drop target
 * for archive drags (reconciliation #3). Status filter is two-way bound to
 * the status bar via state.disk.filters.status.
 */

const MEM_GLYPHS: Record<Membership, string> = { known: '✓', update: '↑', unknown: '✦' };
const MEM_GLYPH_CLASS: Record<Membership, string> = {
  known: 'glyph-mem-known',
  update: 'glyph-mem-update',
  unknown: 'glyph-mem-unknown',
};
const HEALTH_GLYPH_CLASS: Record<HealthVerdict, string> = {
  verified: 'glyph-health-verified',
  heavy: 'glyph-health-heavy',
  broken: 'glyph-health-broken',
  'needs-mod': 'glyph-health-needs-mod',
};
const MEM_SORT: Record<Membership, number> = { update: 0, unknown: 1, known: 2 };
const HEALTH_SORT: Record<HealthVerdict, number> = {
  broken: 0,
  'needs-mod': 1,
  heavy: 2,
  verified: 3,
};

function byName(a: DiskRow, b: DiskRow): number {
  return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
}

/** Every on-disk file a row stands for (dup/version groups included). */
function rowPaths(row: DiskRow): string[] {
  return row.subRows.length > 0 ? row.subRows.map((s) => s.file.path) : [row.primary.path];
}

function lastSegment(path: string): string {
  const parts = path.split(/[\\/]/).filter((p) => p.length > 0);
  return parts[parts.length - 1] ?? path;
}

/** Sub-directory of the file inside its game folder ("Maps\" / "Maps/Custom/"), '' at root. */
function subDirOf(file: ScannedFile): string {
  let rel = file.path.startsWith(file.folder) ? file.path.slice(file.folder.length) : file.path;
  rel = rel.replace(/^[\\/]+/, '');
  const parts = rel.split(/[\\/]/);
  parts.pop(); // file name
  if (parts.length === 0) return '';
  const sep = file.path.includes('\\') ? '\\' : '/';
  return parts.join(sep) + sep;
}

/** Sub-row note: version groups get "{year} · {canonical|installed|latest|superseded}", copies get "{dir} · exact copy". */
function subNote(row: DiskRow, sub: DiskSubRow): string {
  if (row.kind === 'version-group' && !sub.exactCopy) {
    const word = sub.isCanonical
      ? 'canonical'
      : sub.isPrimary
        ? 'installed'
        : sub.isLatest
          ? 'latest'
          : 'superseded';
    return `${new Date(sub.file.mtime).getFullYear()} · ${word}`;
  }
  const dir = subDirOf(sub.file);
  const word = sub.isPrimary ? 'installed' : 'exact copy';
  return dir === '' ? word : `${dir} · ${word}`;
}

function subMetaLine(row: DiskRow, sub: DiskSubRow): string {
  const parts = [subNote(row, sub), playersLabel(sub.file.maxPlayers)];
  if (sub.file.theater !== null) parts.push(sub.file.theater);
  return parts.join(' · ');
}

export function DiskPane() {
  const { state, actions } = useStore();
  const disk = state.disk;
  const listRef = useRef<HTMLDivElement | null>(null);
  const [dragDepth, setDragDepth] = useState(0);

  // --- filter + sort (local — the disk list is fully client-side).
  const visibleRows = useMemo(() => {
    const q = disk.filters.q.trim().toLowerCase();
    const status = disk.filters.status;
    const filtered = disk.rows.filter((row) => {
      if (
        q.length > 0 &&
        !row.name.toLowerCase().includes(q) &&
        !row.primary.fileName.toLowerCase().includes(q)
      ) {
        return false;
      }
      switch (status) {
        case 'all':
          return true;
        case 'known':
        case 'update':
        case 'unknown':
          return row.membership === status;
        case 'broken':
          return row.health.verdict === 'broken';
        case 'needsmod':
          return row.health.verdict === 'needs-mod';
        case 'dup':
          return row.dupCount > 1;
        default:
          return true;
      }
    });
    switch (disk.filters.sort) {
      case 'status':
        return [...filtered].sort(
          (a, b) => MEM_SORT[a.membership] - MEM_SORT[b.membership] || byName(a, b),
        );
      case 'name':
        return [...filtered].sort(byName);
      case 'recent':
        return [...filtered].sort((a, b) => b.primary.mtime - a.primary.mtime || byName(a, b));
      case 'health':
        return [...filtered].sort(
          (a, b) => HEALTH_SORT[a.health.verdict] - HEALTH_SORT[b.health.verdict] || byName(a, b),
        );
      default:
        return filtered;
    }
  }, [disk.rows, disk.filters]);

  // --- keyboard-nav plumbing: flat visible order includes open sub-rows.
  const flatKeys = useMemo(() => {
    const keys: string[] = [];
    for (const row of visibleRows) {
      keys.push(row.key);
      if (row.subRows.length > 0 && disk.openGroups.has(row.key)) {
        for (const sub of row.subRows) keys.push(sub.key);
      }
    }
    return keys;
  }, [visibleRows, disk.openGroups]);
  useEffect(() => {
    actions.registerVisibleIds('disk', flatKeys);
  }, [actions, flatKeys]);
  useEffect(() => () => actions.registerVisibleIds('disk', []), [actions]);
  const searchRef = useCallback(
    (el: HTMLInputElement | null) => {
      actions.registerSearchEl('disk', el);
    },
    [actions],
  );

  const targetId = state.selection.target?.pane === 'disk' ? state.selection.target.id : null;
  useEffect(() => {
    if (targetId === null) return;
    const el = listRef.current?.querySelector(`[data-disk-row="${CSS.escape(targetId)}"]`);
    if (el instanceof HTMLElement) el.scrollIntoView({ block: 'nearest' });
  }, [targetId]);

  const multiKeys = useMemo(
    () => new Set(state.selection.multi.filter((m) => m.pane === 'disk').map((m) => m.id)),
    [state.selection.multi],
  );

  const gameFolders = state.settings?.gameFolders ?? [];
  const defaultFolderPath =
    (gameFolders.find((f) => f.isDefault) ?? gameFolders[0])?.path ?? null;

  const scanPct =
    disk.scanProgress !== null && disk.scanProgress.total > 0
      ? Math.min(100, Math.round((disk.scanProgress.done / disk.scanProgress.total) * 100))
      : 0;

  // --- per-row quick actions (DESIGN.md §5 context matrix).

  function renderQuickAction(row: DiskRow) {
    if (row.membership === 'update' && row.updateTarget !== null) {
      const target = row.updateTarget;
      return (
        <button
          type="button"
          className="chrono-btn newer"
          title="Update (chronoshift canonical)"
          onClick={(e) => {
            e.stopPropagation();
            void actions.chronoshift([
              { slug: target.slug, name: target.name, fileName: row.primary.fileName },
            ]);
          }}
        >
          ⟳
        </button>
      );
    }
    if (row.health.verdict === 'broken') {
      if (row.identity !== null) {
        const identity = row.identity;
        return (
          <button
            type="button"
            className="chrono-btn"
            title="Replace with verified copy"
            onClick={(e) => {
              e.stopPropagation();
              // Decision #6: ask first — the shared confirm lives in ChronoshiftLayer.
              requestSwapConfirm({
                slug: identity.slug,
                name: identity.name,
                fileName: row.primary.fileName,
              });
            }}
          >
            ⟳
          </button>
        );
      }
      return (
        <button
          type="button"
          className="chrome-btn"
          title="Quarantine"
          onClick={(e) => {
            e.stopPropagation();
            void actions.removeToQuarantine(rowPaths(row), row.name);
          }}
        >
          ⌦
        </button>
      );
    }
    if (row.membership === 'unknown') {
      if (row.moderation !== 'unknown') return null; // 'in review' chip carries the state
      return (
        <button
          type="button"
          className="chrome-btn"
          title="Contribute"
          onClick={(e) => {
            e.stopPropagation();
            actions.openContribute();
          }}
        >
          ✦
        </button>
      );
    }
    return (
      <button
        type="button"
        className="chrome-btn"
        title="Re-verify"
        onClick={(e) => {
          e.stopPropagation();
          void actions.reVerify(row.key, row.name);
        }}
      >
        ⟳
      </button>
    );
  }

  return (
    <section
      className={`pane pane-disk${dragDepth > 0 ? ' drop-target' : ''}`}
      onMouseDown={() => {
        if (state.selection.focusedPane !== 'disk') actions.focusPane('disk');
      }}
      onDragEnter={(e) => {
        if (hasMapDrag(e.dataTransfer)) setDragDepth((n) => n + 1);
      }}
      onDragOver={(e) => {
        if (hasMapDrag(e.dataTransfer)) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDragLeave={(e) => {
        if (hasMapDrag(e.dataTransfer)) setDragDepth((n) => Math.max(0, n - 1));
      }}
      onDrop={(e) => {
        const payload = readMapDrag(e.dataTransfer);
        setDragDepth(0);
        if (payload !== null) {
          e.preventDefault();
          void actions.chronoshift([payload]);
        }
      }}
    >
      <div className="pane-header" data-disk-head>
        <span className="pane-title">On Your Disk</span>
        <span className="pane-count">{formatCount(disk.counts.total)}</span>
        <span className="pane-unit">maps</span>
        <div className="pane-header-spacer" />
        <div className="pane-header-actions">
          <button type="button" className="chrome-btn" onClick={() => actions.openTidy()}>
            ⌦ Tidy
          </button>
          <button type="button" className="chrome-btn" onClick={() => void actions.rescan()}>
            <span className={disk.scanning ? 'spin' : undefined}>⟳</span> Rescan
          </button>
        </div>
      </div>

      <div className="filter-strip">
        <div className="filter-row">
          <div className="search-wrap">
            <span className="search-glyph">⌕</span>
            <input
              ref={searchRef}
              className="input"
              type="text"
              placeholder="Filter your maps…"
              value={disk.filters.q}
              onChange={(e) => actions.setDiskFilters({ q: e.target.value })}
            />
          </div>
        </div>
        <div className="filter-row">
          <label className="select-wrap">
            <select
              className="select"
              aria-label="Status"
              value={disk.filters.status}
              onChange={(e) => actions.setDiskFilters({ status: e.target.value as DiskStatusFilter })}
            >
              <option value="all">All statuses</option>
              <option value="known">Known</option>
              <option value="update">Update</option>
              <option value="unknown">Unknown</option>
              <option value="broken">Broken</option>
              <option value="needsmod">Needs a mod</option>
              <option value="dup">Duplicates</option>
            </select>
            <span className="select-chevron">⌄</span>
          </label>
          <div className="filter-row-spacer" />
          <span className="sort-label">Sort</span>
          <label className="select-wrap">
            <select
              className="select select-wide"
              aria-label="Sort"
              value={disk.filters.sort}
              onChange={(e) => actions.setDiskFilters({ sort: e.target.value as DiskSort })}
            >
              <option value="status">Status</option>
              <option value="name">Name</option>
              <option value="recent">Recently added</option>
              <option value="health">Health</option>
            </select>
            <span className="select-chevron">⌄</span>
          </label>
        </div>
      </div>

      {disk.scanning ? (
        <div className="scan-strip">
          <span className="scan-strip-label">Scanning game folder…</span>
          <div className="scan-track">
            <div className="scan-fill" style={{ width: `${scanPct}%` }} />
          </div>
          <span className="scan-pct">{scanPct}%</span>
        </div>
      ) : null}

      <NewMapsBanner />

      {disk.rows.length === 0 ? (
        disk.scanning ? (
          <div className="list-scroll">
            <SkeletonRows count={6} />
          </div>
        ) : (
          <div className="pane-state">
            <div className="pane-state-title">Nothing installed yet.</div>
            <div className="pane-state-body">
              The archive's on the left — chronoshift something in.
            </div>
          </div>
        )
      ) : visibleRows.length === 0 ? (
        <div className="pane-state">
          <div className="pane-state-title">Nothing matches.</div>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => actions.setDiskFilters({ q: '', status: 'all' })}
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className="list-scroll" ref={listRef}>
          {visibleRows.map((row) => {
            const open = row.subRows.length > 0 && disk.openGroups.has(row.key);
            const selected = targetId === row.key;
            const checked = multiKeys.has(row.key);
            const showFolderChip =
              gameFolders.length > 1 &&
              defaultFolderPath !== null &&
              row.folder !== defaultFolderPath;
            return (
              <Fragment key={row.key}>
                <div
                  data-disk-row={row.key}
                  className={`row${selected ? ' selected' : ''}`}
                  onClick={() => actions.select('disk', row.key)}
                >
                  <button
                    type="button"
                    className={`row-check${checked ? ' checked' : ''}`}
                    title="Select"
                    aria-pressed={checked}
                    onClick={(e) => {
                      e.stopPropagation();
                      actions.toggleMulti('disk', row.key);
                    }}
                  >
                    {checked ? '✓' : ''}
                  </button>
                  <DiskThumb file={row.primary} />
                  <div className="glyph-col">
                    <span
                      className={`mem-glyph ${MEM_GLYPH_CLASS[row.membership]}`}
                      title={row.membership}
                    >
                      {MEM_GLYPHS[row.membership]}
                    </span>
                    <span
                      className={`health-glyph ${HEALTH_GLYPH_CLASS[row.health.verdict]}`}
                      title={healthWord(row.health.verdict)}
                    >
                      {HEALTH_GLYPHS[row.health.verdict]}
                    </span>
                  </div>
                  <div className="row-text">
                    <div className="row-name">
                      <span>{row.name}</span>
                      {showFolderChip ? (
                        <span className="chip-folder">{lastSegment(row.folder)}</span>
                      ) : null}
                    </div>
                    <div className="row-meta">
                      {diskMetaLine({
                        membership: row.membership,
                        healthVerdict: row.health.verdict,
                        maxPlayers: row.primary.maxPlayers,
                        theater: row.primary.theater,
                      })}
                    </div>
                  </div>
                  <div className="row-right">
                    {shouldNudge(row, state.nudgesDismissed) ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                        <button
                          type="button"
                          className="nudge"
                          title={`You’ve got ${row.name} installed — review it?`}
                          onClick={(e) => {
                            e.stopPropagation();
                            const slug = row.identity?.slug;
                            if (slug !== undefined) actions.openReviewModal(slug, row.name);
                          }}
                        >
                          review?
                        </button>
                        <button
                          type="button"
                          className="banner-dismiss"
                          title="Dismiss"
                          style={{ fontSize: 10, padding: '0 2px' }}
                          onClick={(e) => {
                            e.stopPropagation();
                            actions.dismissNudge(row.contentHash);
                          }}
                        >
                          ✕
                        </button>
                      </span>
                    ) : null}
                    {row.versionCount > 1 ? (
                      <span className="chip chip-flag-gold">{row.versionCount} versions</span>
                    ) : null}
                    {row.dupCount > 1 ? (
                      <span className="chip chip-flag-neutral">⧉ ×{row.dupCount}</span>
                    ) : null}
                    {row.updateTarget !== null ? (
                      <span className="chip chip-flag-gold">→ canonical</span>
                    ) : null}
                    {row.moderation === 'in-review' ? (
                      <span className="chip chip-flag-neutral">in review</span>
                    ) : null}
                    {renderQuickAction(row)}
                    {row.subRows.length > 0 ? (
                      <button
                        type="button"
                        className={`group-caret${open ? ' open' : ''}`}
                        title={open ? 'Collapse' : 'Expand'}
                        onClick={(e) => {
                          e.stopPropagation();
                          actions.toggleGroup(row.key);
                        }}
                      >
                        {open ? '⌃' : '⌄'}
                      </button>
                    ) : null}
                  </div>
                </div>
                {open
                  ? row.subRows.map((sub) => {
                      const subSelected = targetId === sub.key;
                      const mono = sub.file.fileName.toLowerCase().includes('.map');
                      return (
                        <div
                          key={sub.key}
                          data-disk-row={sub.key}
                          className={`row sub-row${subSelected ? ' selected' : ''}`}
                          onClick={() => actions.select('disk', sub.key)}
                        >
                          <DiskThumb file={sub.file} small />
                          <div className="row-text">
                            <div className={`row-name${mono ? ' mono' : ''}`}>
                              <span>{sub.file.fileName}</span>
                            </div>
                            <div className="row-meta">{subMetaLine(row, sub)}</div>
                          </div>
                        </div>
                      );
                    })
                  : null}
              </Fragment>
            );
          })}
        </div>
      )}

    </section>
  );
}
