import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MAP_TYPES,
  MAP_TYPE_LABELS,
  MIN_PLAYER_BUCKETS,
  SIZE_CLASSES,
  TEAM_LAYOUTS,
  THEATERS,
  type ArchiveSort,
  type MapType,
  type SizeClass,
  type TeamLayout,
  type Theater,
} from '@antares/shared/taxonomy.ts';
import type { MapCardDto } from '@antares/shared/types.ts';
import {
  archiveMetaLine,
  formatCompact,
  formatCount,
  formatRating,
  starString,
  teamLabel,
} from '../lib/format.ts';
import { ConnectionLostState } from '../flows/PaneStates.tsx';
import { archiveInstallState } from '../lib/reconcile.ts';
import type { InstallState } from '../lib/types.ts';
import { resolveAssetUrl } from '../lib/url.ts';
import { useStore } from '../state/store.tsx';
import { setMapDrag } from './dnd.ts';
import { ArchiveThumb, SkeletonRows } from './visuals.tsx';

/**
 * The Archive pane (screens.md §3): header with the live API total, search +
 * five facet selects + sort (shared taxonomy vocabulary), the paged row list
 * (infinite scroll + "Showing N of M · Load more"), install-state markers
 * derived from disk hashes, per-row ⟳ chronoshift, drag-to-install source
 * rows (reconciliation #3), connection-lost / empty / skeleton states.
 */

const SIZE_WORDS: Record<SizeClass, string> = { small: 'Small', medium: 'Medium', large: 'Large' };
const LOAD_MORE_THRESHOLD_PX = 240;

/** Quality-score pill, coloured by band (green ≥8, gold ≥6, amber ≥4, red below). */
function scorePillStyle(s: number) {
  const [fg, bg] =
    s >= 8
      ? ['#4ade80', 'rgba(74,222,128,0.16)']
      : s >= 6
        ? ['#c9a24b', 'rgba(201,162,75,0.18)']
        : s >= 4
          ? ['#e0902e', 'rgba(224,144,46,0.16)']
          : ['#e06a62', 'rgba(224,106,98,0.16)'];
  return {
    fontSize: 11,
    fontWeight: 800,
    padding: '1px 6px',
    borderRadius: 5,
    color: fg,
    background: bg,
    whiteSpace: 'nowrap' as const,
    alignSelf: 'center' as const,
  };
}

export function ArchivePane() {
  const { state, actions } = useStore();
  const archive = state.archive;
  const apiBase = state.settings?.apiBase ?? 'http://localhost:3000';
  const listRef = useRef<HTMLDivElement | null>(null);

  // --- search box: live-typed locally, committed to the store (server query) debounced.
  const [q, setQ] = useState(archive.filters.q);
  const lastSentQ = useRef(archive.filters.q);
  const debounceRef = useRef<number | null>(null);
  useEffect(() => {
    // External change (Clear filters) — resync the box.
    if (archive.filters.q !== lastSentQ.current) {
      lastSentQ.current = archive.filters.q;
      setQ(archive.filters.q);
    }
  }, [archive.filters.q]);
  useEffect(
    () => () => {
      if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    },
    [],
  );
  const onSearchChange = (value: string): void => {
    setQ(value);
    if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      lastSentQ.current = value;
      actions.setArchiveFilters({ q: value });
    }, 250);
  };

  const connLost = state.connection === 'offline' || archive.error !== null;

  // --- keyboard-nav plumbing: visible order + search element. When the pane
  // shows the connection-lost state the list is hidden — register nothing so
  // the arrow keys can't walk invisible rows.
  const slugs = useMemo(
    () => (connLost ? [] : archive.items.map((c) => c.slug)),
    [connLost, archive.items],
  );
  useEffect(() => {
    actions.registerVisibleIds('archive', slugs);
  }, [actions, slugs]);
  useEffect(() => () => actions.registerVisibleIds('archive', []), [actions]);
  const searchRef = useCallback(
    (el: HTMLInputElement | null) => {
      actions.registerSearchEl('archive', el);
    },
    [actions],
  );

  // Keep the selected row in view for keyboard nav; clicking never jumps
  // (block:'nearest' is a no-op for already-visible rows → scroll preserved).
  const targetId = state.selection.target?.pane === 'archive' ? state.selection.target.id : null;
  useEffect(() => {
    if (targetId === null) return;
    const el = listRef.current?.querySelector(`[data-arc="${CSS.escape(targetId)}"]`);
    if (el instanceof HTMLElement) el.scrollIntoView({ block: 'nearest' });
  }, [targetId]);

  const onListScroll = (): void => {
    const el = listRef.current;
    if (el === null) return;
    if (el.scrollHeight - el.scrollTop - el.clientHeight < LOAD_MORE_THRESHOLD_PX) {
      void actions.loadMoreArchive();
    }
  };

  const install = (card: MapCardDto): InstallState => archiveInstallState(card, state.disk.hashes);
  const chronoRequest = (card: MapCardDto) => ({
    slug: card.slug,
    name: card.name,
    fileName: `${card.slug}.map`,
  });

  return (
    <section
      className="pane pane-archive"
      onMouseDown={() => {
        if (state.selection.focusedPane !== 'archive') actions.focusPane('archive');
      }}
    >
      <div className="pane-header">
        <span className="pane-title">The Archive</span>
        <span className="pane-count">{formatCount(archive.total)}</span>
        <span className="pane-unit">maps</span>
      </div>

      <div className="filter-strip">
        <div className="filter-row">
          <div className="search-wrap">
            <span className="search-glyph">⌕</span>
            <input
              ref={searchRef}
              className="input"
              type="text"
              placeholder="Search the archive…   ( / )"
              value={q}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </div>
        </div>
        <div className="filter-row">
          <label className="select-wrap">
            <select
              className="select"
              aria-label="Type"
              value={archive.filters.type}
              onChange={(e) => actions.setArchiveFilters({ type: e.target.value as MapType | 'all' })}
            >
              <option value="all">All types</option>
              {MAP_TYPES.map((t) => (
                <option key={t} value={t}>
                  {MAP_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            <span className="select-chevron">⌄</span>
          </label>
          <label className="select-wrap">
            <select
              className="select"
              aria-label="Players"
              value={archive.filters.minPlayers === null ? '' : String(archive.filters.minPlayers)}
              onChange={(e) =>
                actions.setArchiveFilters({
                  minPlayers: e.target.value === '' ? null : (Number(e.target.value) as 2 | 4 | 6 | 8),
                })
              }
            >
              <option value="">Any</option>
              {MIN_PLAYER_BUCKETS.map((n) => (
                <option key={n} value={n}>
                  {n === 8 ? '8' : `${n}+`}
                </option>
              ))}
            </select>
            <span className="select-chevron">⌄</span>
          </label>
          <label className="select-wrap">
            <select
              className="select"
              aria-label="Theater"
              value={archive.filters.theater}
              onChange={(e) =>
                actions.setArchiveFilters({ theater: e.target.value as Theater | 'all' })
              }
            >
              <option value="all">All theaters</option>
              {THEATERS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <span className="select-chevron">⌄</span>
          </label>
          <label className="select-wrap">
            <select
              className="select"
              aria-label="Team"
              value={archive.filters.team}
              onChange={(e) =>
                actions.setArchiveFilters({ team: e.target.value as TeamLayout | 'any' })
              }
            >
              <option value="any">Any</option>
              {TEAM_LAYOUTS.map((t) => (
                <option key={t} value={t}>
                  {teamLabel(t)}
                </option>
              ))}
            </select>
            <span className="select-chevron">⌄</span>
          </label>
          <label className="select-wrap">
            <select
              className="select"
              aria-label="Size"
              value={archive.filters.size}
              onChange={(e) =>
                actions.setArchiveFilters({ size: e.target.value as SizeClass | 'any' })
              }
            >
              <option value="any">Any size</option>
              {SIZE_CLASSES.map((s) => (
                <option key={s} value={s}>
                  {SIZE_WORDS[s]}
                </option>
              ))}
            </select>
            <span className="select-chevron">⌄</span>
          </label>
          <div className="filter-row-spacer" />
          <span className="sort-label">Sort</span>
          <label className="select-wrap">
            <select
              className="select select-wide"
              aria-label="Sort"
              value={archive.filters.sort}
              onChange={(e) => actions.setArchiveFilters({ sort: e.target.value as ArchiveSort })}
            >
              <option value="downloads">Most downloaded</option>
              <option value="newest">Newest</option>
              <option value="rating">Highest rated</option>
              <option value="quality">Highest quality</option>
            </select>
            <span className="select-chevron">⌄</span>
          </label>
        </div>
      </div>

      {connLost ? (
        <ConnectionLostState />
      ) : archive.loading ? (
        <div className="list-scroll">
          <SkeletonRows count={8} />
        </div>
      ) : archive.items.length === 0 ? (
        <div className="pane-state">
          <div className="pane-state-title">Nothing matches.</div>
          <button type="button" className="btn btn-ghost" onClick={() => actions.clearArchiveFilters()}>
            Clear filters
          </button>
        </div>
      ) : (
        <div className="list-scroll" ref={listRef} onScroll={onListScroll}>
          {archive.items.map((card) => {
            const installState = install(card);
            const selected = targetId === card.slug;
            return (
              <div
                key={card.slug}
                data-arc={card.slug}
                className={`row${selected ? ' selected' : ''}`}
                draggable
                onDragStart={(e) => setMapDrag(e.dataTransfer, chronoRequest(card))}
                onClick={() => actions.select('archive', card.slug)}
                onDoubleClick={() => {
                  if (installState !== 'have') void actions.chronoshift([chronoRequest(card)]);
                }}
              >
                <ArchiveThumb url={resolveAssetUrl(apiBase, card.thumbnailUrl)} alt={`${card.name} preview`} />
                <div className="row-text">
                  <div className="row-name">
                    <span>{card.name}</span>
                    {card.authorId !== null ? <span className="verified-star">✦</span> : null}
                    {(card.versionCount ?? 1) > 1 ? (
                      <button
                        type="button"
                        className="row-versions"
                        title={`Choose from ${card.versionCount} versions`}
                        onClick={(e) => {
                          e.stopPropagation();
                          actions.openVersionPicker(card.slug, card.name);
                        }}
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: '#c9a24b',
                          marginLeft: 6,
                          whiteSpace: 'nowrap',
                          cursor: 'pointer',
                          background: 'transparent',
                          border: 'none',
                          padding: 0,
                          textDecoration: 'underline dotted',
                        }}
                      >
                        {card.versionCount} versions ▾
                      </button>
                    ) : null}
                  </div>
                  <div className="row-meta">{archiveMetaLine(card)}</div>
                </div>
                <div className="row-right">
                  {typeof card.lintScore === 'number' ? (
                    <span className="row-score" title={`Quality ${card.lintScore.toFixed(1)}/10`} style={scorePillStyle(card.lintScore)}>
                      {card.lintScore.toFixed(1)}
                    </span>
                  ) : null}
                  <div className="row-rating">
                    {card.rating !== null ? (
                      <div className="row-stars">
                        {starString(card.rating)}{' '}
                        <span className="rating-value">{formatRating(card.rating)}</span>
                      </div>
                    ) : null}
                    <div className="row-dl">{formatCompact(card.downloads)} dl</div>
                  </div>
                  {installState === 'have' ? <span className="chip chip-have">✓ have</span> : null}
                  {installState === 'newer' ? <span className="chip chip-newer">↑ newer</span> : null}
                  {installState !== 'have' ? (
                    <button
                      type="button"
                      className={`chrono-btn${installState === 'newer' ? ' newer' : ''}`}
                      title="Chronoshift"
                      onClick={(e) => {
                        e.stopPropagation();
                        void actions.chronoshift([chronoRequest(card)]);
                      }}
                    >
                      ⟳
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
          {archive.loadingMore ? <SkeletonRows count={3} /> : null}
          <div className="list-footer">
            Showing {formatCount(archive.items.length)} of {formatCount(archive.total)}
            {!archive.endReached ? (
              <>
                {' · '}
                <button
                  type="button"
                  className="link"
                  disabled={archive.loadingMore}
                  onClick={() => void actions.loadMoreArchive()}
                >
                  {archive.loadingMore ? 'Loading…' : 'Load more'}
                </button>
              </>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
