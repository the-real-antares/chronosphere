import { useEffect, useState } from 'react';
import type { ContributorDto } from '@antares/shared/types.ts';
import type { ContributorProfileDto } from '../api/client.ts';
import { archiveMetaLine, formatDateMonth } from '../lib/format.ts';
import { useStore } from '../state/store.tsx';
import { ModalHeader, ModalShell } from './common.tsx';

/**
 * Contributor profile + top-contributors leaderboard — light, modest panels
 * (DESIGN.md §7: "motivating, not a competitive centerpiece"). The store has
 * no panel state, so this component keeps its own and is opened via the
 * exported helpers (SettingsModal keeps it mounted for the app's lifetime).
 */

const OPEN_PANEL_EVENT = 'chronosphere:open-panel';

type PanelRequest = { kind: 'profile'; handle: string } | { kind: 'leaderboard' };

export function openContributorProfile(handle: string): void {
  window.dispatchEvent(new CustomEvent<PanelRequest>(OPEN_PANEL_EVENT, { detail: { kind: 'profile', handle } }));
}

export function openLeaderboard(): void {
  window.dispatchEvent(new CustomEvent<PanelRequest>(OPEN_PANEL_EVENT, { detail: { kind: 'leaderboard' } }));
}

type LeaderboardSort = 'maps' | 'reviews' | 'tags';

export function ProfilePanel() {
  const [panel, setPanel] = useState<PanelRequest | null>(null);

  useEffect(() => {
    const onOpen = (e: Event): void => {
      const detail = (e as CustomEvent<PanelRequest>).detail;
      if (detail !== undefined && detail !== null) setPanel(detail);
    };
    window.addEventListener(OPEN_PANEL_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_PANEL_EVENT, onOpen);
  }, []);

  // Close on Escape ahead of the app-level handler.
  useEffect(() => {
    if (panel === null) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setPanel(null);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [panel]);

  if (panel === null) return null;
  const close = (): void => setPanel(null);

  return (
    <ModalShell onClose={close}>
      {panel.kind === 'profile' ? (
        <ProfileBody handle={panel.handle} onClose={close} />
      ) : (
        <LeaderboardBody
          onClose={close}
          onOpenProfile={(handle) => setPanel({ kind: 'profile', handle })}
        />
      )}
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------

function ProfileBody({ handle, onClose }: { handle: string; onClose: () => void }) {
  const { api } = useStore();
  const [profile, setProfile] = useState<ContributorProfileDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setProfile(null);
    setError(null);
    void api.getContributor(handle).then((result) => {
      if (!live) return;
      if (result.ok) setProfile(result.data);
      else setError(result.error.message);
    });
    return () => {
      live = false;
    };
  }, [api, handle, attempt]);

  return (
    <>
      <ModalHeader onClose={onClose}>
        <span className="modal-title">
          Contributor{' '}
          <span style={{ color: 'var(--text-mid)', fontWeight: 600 }}>— @{handle}</span>
        </span>
      </ModalHeader>
      <div className="modal-body">
        {error !== null ? (
          <div className="pane-state" style={{ padding: '18px 0' }}>
            <div className="pane-state-body">Couldn’t load this profile.</div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAttempt((a) => a + 1)}>
              ⟳ Retry
            </button>
          </div>
        ) : profile === null ? (
          <div className="detail-empty">Loading…</div>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span className="avatar-discord" />
              <div>
                <div className="setting-row-title">@{profile.contributor.discordHandle}</div>
                <div className="setting-row-sub">Since {formatDateMonth(profile.contributor.since)}</div>
              </div>
              <span style={{ flex: 1 }} />
              {profile.contributor.badges.map((badge) => (
                <span key={badge} className="chip chip-contrib-badge">
                  {badge}
                </span>
              ))}
            </div>
            <div className="stat-band">
              <div>
                <div className="stat-num">{profile.contributor.acceptedContributions}</div>
                <div className="stat-label">Maps added</div>
              </div>
              <div>
                <div className="stat-num">{profile.contributor.reviewCount}</div>
                <div className="stat-label">Reviews</div>
              </div>
              <div>
                <div className="stat-num">{profile.contributor.confirmedTags}</div>
                <div className="stat-label">Tags confirmed</div>
              </div>
            </div>
            <div className="section-label">Accepted maps</div>
            {profile.maps.length === 0 ? (
              <div className="detail-empty">Nothing accepted yet.</div>
            ) : (
              profile.maps.map((card) => (
                <div
                  key={card.identityId}
                  style={{ padding: '8px 0', borderTop: '1px solid var(--hairline)' }}
                >
                  <div className="row-name">
                    <span>{card.name}</span>
                    {card.authorId !== null ? <span className="verified-star">✦</span> : null}
                  </div>
                  <div className="row-meta">{archiveMetaLine(card)}</div>
                </div>
              ))
            )}
          </>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

const SORT_COLUMNS: { key: LeaderboardSort; label: string }[] = [
  { key: 'maps', label: 'maps added' },
  { key: 'reviews', label: 'reviews' },
  { key: 'tags', label: 'tags confirmed' },
];

function LeaderboardBody({
  onClose,
  onOpenProfile,
}: {
  onClose: () => void;
  onOpenProfile: (handle: string) => void;
}) {
  const { api } = useStore();
  const [sort, setSort] = useState<LeaderboardSort>('maps');
  const [rows, setRows] = useState<ContributorDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setRows(null);
    setError(null);
    void api.getContributors(sort).then((result) => {
      if (!live) return;
      if (result.ok) setRows(result.data);
      else setError(result.error.message);
    });
    return () => {
      live = false;
    };
  }, [api, sort, attempt]);

  const countFor = (row: ContributorDto, key: LeaderboardSort): number =>
    key === 'maps' ? row.acceptedContributions : key === 'reviews' ? row.reviewCount : row.confirmedTags;

  return (
    <>
      <ModalHeader onClose={onClose}>
        <span className="modal-title">Top contributors</span>
      </ModalHeader>
      <div className="modal-body">
        <div className="review-sort-row" style={{ marginTop: 0 }}>
          <span className="sort-label">Rank by</span>
          {SORT_COLUMNS.map((col) => (
            <button
              key={col.key}
              type="button"
              className={`review-sort-opt${sort === col.key ? ' active' : ''}`}
              onClick={() => setSort(col.key)}
            >
              {col.label}
            </button>
          ))}
        </div>
        {error !== null ? (
          <div className="pane-state" style={{ padding: '18px 0' }}>
            <div className="pane-state-body">Couldn’t load the leaderboard.</div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAttempt((a) => a + 1)}>
              ⟳ Retry
            </button>
          </div>
        ) : rows === null ? (
          <div className="detail-empty">Loading…</div>
        ) : rows.length === 0 ? (
          <div className="detail-empty">No contributors yet.</div>
        ) : (
          rows.map((row, i) => (
            <div
              key={row.discordHandle}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 0',
                borderTop: '1px solid var(--hairline)',
              }}
            >
              <span
                style={{
                  width: 22,
                  color: 'var(--text-faint)',
                  fontVariantNumeric: 'tabular-nums',
                  fontSize: 11.5,
                }}
              >
                {i + 1}
              </span>
              <button
                type="button"
                className="link link-dim"
                style={{ fontSize: 12.5 }}
                onClick={() => onOpenProfile(row.discordHandle)}
              >
                @{row.discordHandle}
              </button>
              {row.badges.length > 0 ? (
                <span className="chip chip-contrib-badge">{row.badges[row.badges.length - 1]}</span>
              ) : null}
              <span style={{ flex: 1 }} />
              <span
                style={{
                  fontSize: 12.5,
                  color: 'var(--text-hi)',
                  fontWeight: 700,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {countFor(row, sort)}
              </span>
              <span className="row-meta" style={{ width: 92, textAlign: 'right' }}>
                {SORT_COLUMNS.find((c) => c.key === sort)?.label ?? ''}
              </span>
            </div>
          ))
        )}
      </div>
    </>
  );
}
