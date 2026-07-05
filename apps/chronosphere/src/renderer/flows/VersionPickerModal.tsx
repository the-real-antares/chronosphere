import { useEffect, useState } from 'react';
import type { GroupVersionDto } from '@antares/shared/types.ts';
import { formatCompact } from '../lib/format.ts';
import { useStore } from '../state/store.tsx';
import { ModalHeader, ModalShell } from './common.tsx';

/**
 * Version picker: a searchable, scrollable list of every distinct-content
 * version in a map's version group. Opened from the archive card's "N versions"
 * badge; installs the chosen version via chronoshift. Marks versions already on
 * disk as "have".
 */
export function VersionPickerModal() {
  const { state, actions, api } = useStore();
  const vp = state.versionPicker;
  const [q, setQ] = useState('');
  const [versions, setVersions] = useState<GroupVersionDto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!vp.open || vp.slug === null) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    setVersions([]);
    setQ('');
    void api.getGroupVersions(vp.slug).then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (res.ok) setVersions(res.data.versions);
      else setError(res.error.message ?? 'Failed to load versions');
    });
    return () => {
      cancelled = true;
    };
  }, [vp.open, vp.slug, api]);

  if (!vp.open) return null;

  const needle = q.trim().toLowerCase();
  const filtered = needle ? versions.filter((v) => v.name.toLowerCase().includes(needle)) : versions;

  const install = (v: GroupVersionDto): void => {
    void actions.chronoshift([{ slug: v.slug, name: v.name, fileName: `${v.slug}.map` }]);
    actions.closeVersionPicker();
  };

  return (
    <ModalShell className="modal-versions" onClose={actions.closeVersionPicker}>
      <ModalHeader onClose={actions.closeVersionPicker}>
        {vp.mapName}
        {versions.length > 0 ? ` — ${versions.length} versions` : ''}
      </ModalHeader>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '4px 2px', minHeight: 200 }}>
        <input
          className="input"
          type="text"
          placeholder="Search versions…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          // eslint-disable-next-line jsx-a11y/no-autofocus -- modal search field
          autoFocus
        />
        {loading ? (
          <div style={{ opacity: 0.6, padding: '24px 0', textAlign: 'center' }}>Loading versions…</div>
        ) : error ? (
          <div style={{ color: '#e06a62', padding: '24px 0', textAlign: 'center' }}>{error}</div>
        ) : filtered.length === 0 ? (
          <div style={{ opacity: 0.6, padding: '24px 0', textAlign: 'center' }}>No versions match “{q}”.</div>
        ) : (
          <div style={{ maxHeight: '52vh', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
            {filtered.map((v) => {
              const have = v.canonicalHash !== '' && state.disk.hashes.has(v.canonicalHash);
              return (
                <div
                  key={v.slug}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 4px',
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {v.name}
                      {v.isCanonical ? (
                        <span style={{ color: '#c9a24b', marginLeft: 6 }} title="Recommended (canonical)">
                          ★
                        </span>
                      ) : null}
                    </div>
                    <div style={{ fontSize: 11, opacity: 0.7, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {v.theater} · {v.maxPlayers ?? '?'}P · {v.width}×{v.height}
                      {typeof v.lintScore === 'number' ? ` · quality ${v.lintScore.toFixed(1)}` : ''}
                      {v.healthVerdict === 'broken' ? ' · ⚠ broken' : ''}
                      {` · ${formatCompact(v.downloads)} dl`}
                    </div>
                  </div>
                  {have ? (
                    <span className="chip chip-have">✓ have</span>
                  ) : (
                    <button type="button" className="chrono-btn" title="Install this version" onClick={() => install(v)}>
                      ⟳
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </ModalShell>
  );
}
