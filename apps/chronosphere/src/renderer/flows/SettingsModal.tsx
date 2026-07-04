import { useEffect, useState } from 'react';
import type { ContributorDto } from '@antares/shared/types.ts';
import { formatKb, formatRelative } from '../lib/format.ts';
import { useAppState, useStore } from '../state/store.tsx';
import { ModalHeader, ModalShell, SignInControls } from './common.tsx';
import { openContributorProfile, openLeaderboard, ProfilePanel } from './ProfilePanel.tsx';

/**
 * Settings modal (screens.md §9.1) — four sections: Game folders (list +
 * default target + re-detect), Account (sign in/out + profile link), Storage
 * (quarantine bin view/restore/empty · render cache · session-cache note),
 * Preferences (easter eggs · reduced motion · archive server). Footer carries
 * the version line, the EA disclaimer, Replay first-run and the
 * check-for-updates stub.
 *
 * The ProfilePanel stays mounted here even while Settings is closed so the
 * profile/leaderboard panels can open from anywhere.
 */

export function SettingsModal() {
  const open = useAppState().settingsModalOpen;
  return (
    <>
      {open ? <SettingsModalInner /> : null}
      <ProfilePanel />
    </>
  );
}

function SettingsModalInner() {
  const { state, actions, api } = useStore();
  const settings = state.settings;
  const folders = settings?.gameFolders ?? [];

  const [addOpen, setAddOpen] = useState(false);
  const [addPath, setAddPath] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [addBusy, setAddBusy] = useState(false);
  const [redetecting, setRedetecting] = useState(false);
  const [quarantineOpen, setQuarantineOpen] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  const [apiEdit, setApiEdit] = useState<string | null>(null);
  const [me, setMe] = useState<ContributorDto | null>(null);

  useEffect(() => {
    window.chrono
      .appInfo()
      .then((info) => setVersion(info.appVersion))
      .catch(() => {
        /* footer falls back to the bare product name */
      });
  }, []);

  // Signed-in card sub-line ("Discord · N contributions · badge") from the API.
  const handle = state.session.handle;
  useEffect(() => {
    if (handle === null) {
      setMe(null);
      return;
    }
    let live = true;
    void api.getContributor(handle).then((result) => {
      if (live && result.ok) setMe(result.data.contributor);
    });
    return () => {
      live = false;
    };
  }, [api, handle]);

  const close = (): void => actions.closeSettingsModal();

  const submitAdd = async (): Promise<void> => {
    const p = addPath.trim();
    if (p === '' || addBusy) return;
    setAddBusy(true);
    setAddError(null);
    const result = await actions.addGameFolder(p);
    setAddBusy(false);
    if (!result.ok) {
      setAddError(result.reason);
      return;
    }
    setAddPath('');
    setAddOpen(false);
  };

  const redetect = async (): Promise<void> => {
    if (redetecting) return;
    setRedetecting(true);
    const found = await actions.autoDetectFolders();
    const known = new Set(folders.map((f) => f.path));
    let added = 0;
    for (const p of found) {
      if (known.has(p)) continue;
      const result = await actions.addGameFolder(p);
      if (result.ok) {
        added += 1;
        known.add(p);
      }
    }
    setRedetecting(false);
    actions.pushToast({
      kind: 'ok',
      glyph: '⟳',
      title: 'Re-detect complete.',
      sub: added > 0 ? `${added} new install${added === 1 ? '' : 's'} added.` : 'No new installs found.',
    });
  };

  const checkUpdates = (): void => {
    actions.pushToast({
      kind: 'ok',
      title: 'Up to date.',
      sub: `Chronosphere ${version !== null ? `v${version}` : ''} is the latest signed build.`.replace('  ', ' '),
    });
  };

  const storage = state.storage;
  const quarantineCount = storage?.quarantine.reduce((sum, q) => sum + q.count, 0) ?? 0;

  const mySub =
    me !== null
      ? `Discord · ${me.acceptedContributions} contribution${me.acceptedContributions === 1 ? '' : 's'}${
          me.badges.length > 0 ? ` · ✦ ${me.badges[me.badges.length - 1] ?? ''}` : ''
        }`
      : 'Discord';

  return (
    <ModalShell className="modal-settings" onClose={close}>
      <ModalHeader onClose={close}>
        <span className="modal-title">Settings</span>
      </ModalHeader>
      <div className="modal-body">
        {/* --- Game folders -------------------------------------------------- */}
        <div className="settings-section">
          <div className="settings-section-title">
            Game folders // {folders.length} install{folders.length === 1 ? '' : 's'}
          </div>
          {folders.length === 0 ? (
            <div className="detail-empty">No game folder configured — add one below.</div>
          ) : null}
          {folders.map((f) => {
            const count = state.disk.files.filter((file) => file.folder === f.path).length;
            return (
              <div key={f.path} className="install-card">
                <span className="pip-green" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="install-path" title={f.path}>
                    {f.path}
                  </div>
                  <div className="install-sub">
                    {count} map{count === 1 ? '' : 's'}
                  </div>
                </div>
                {f.isDefault ? (
                  <span className="chip chip-default-target">Default target</span>
                ) : (
                  <button
                    type="button"
                    className="chrome-btn"
                    onClick={() => void actions.setDefaultFolder(f.path)}
                  >
                    Set default
                  </button>
                )}
                <button
                  type="button"
                  className="modal-close"
                  title="Remove"
                  aria-label={`Remove ${f.path}`}
                  onClick={() => void actions.removeGameFolder(f.path)}
                >
                  ✕
                </button>
              </div>
            );
          })}
          <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAddOpen((v) => !v)}>
              + Add install
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              disabled={redetecting}
              onClick={() => void redetect()}
            >
              <span className={redetecting ? 'spin' : ''}>⟳</span> Re-detect
            </button>
          </div>
          {addOpen ? (
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <input
                className="input mono"
                style={{ fontSize: 12.5 }}
                placeholder="Path to a Yuri’s Revenge folder"
                value={addPath}
                onChange={(e) => {
                  setAddPath(e.target.value);
                  setAddError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submitAdd();
                }}
              />
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                disabled={addBusy || addPath.trim() === ''}
                onClick={() => void submitAdd()}
              >
                Add
              </button>
            </div>
          ) : null}
          {addError !== null ? (
            <div style={{ color: 'var(--error-text)', fontSize: 12, marginTop: 8 }}>⚠ {addError}</div>
          ) : null}
        </div>

        {/* --- Account -------------------------------------------------------- */}
        <div className="settings-section">
          <div className="settings-section-title">Account</div>
          {state.session.signedIn ? (
            <div className="install-card">
              <span className="avatar-discord" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="setting-row-title">@{state.session.handle ?? ''}</div>
                <div className="install-sub">{mySub}</div>
              </div>
              <button
                type="button"
                className="link link-dim"
                onClick={() => openContributorProfile(state.session.handle ?? '')}
              >
                View profile
              </button>
              <button type="button" className="chrome-btn" onClick={() => void actions.signOut()}>
                Sign out
              </button>
            </div>
          ) : (
            <div>
              <div className="onb-body-sm" style={{ marginBottom: 12 }}>
                Sign in to review, confirm tags, and contribute. Browsing and installing need no
                account.
              </div>
              <SignInControls align="start" />
            </div>
          )}
          <div style={{ marginTop: 10 }}>
            <button type="button" className="link link-dim" onClick={() => openLeaderboard()}>
              Top contributors
            </button>
          </div>
        </div>

        {/* --- Storage -------------------------------------------------------- */}
        <div className="settings-section">
          <div className="settings-section-title">Storage</div>
          <div className="setting-row">
            <div className="setting-row-text">
              <div className="setting-row-title">Quarantine bin</div>
              <div className="setting-row-sub">
                {storage === null ? '…' : `${quarantineCount} maps · recoverable`}
              </div>
            </div>
            <button type="button" className="chrome-btn" onClick={() => setQuarantineOpen((v) => !v)}>
              View
            </button>
            <button
              type="button"
              className="chrome-btn"
              disabled={quarantineCount === 0}
              onClick={() => void actions.emptyQuarantine()}
            >
              Empty
            </button>
          </div>
          {quarantineOpen && storage !== null ? (
            storage.quarantine.length === 0 ? (
              <div className="install-sub" style={{ padding: '0 0 8px' }}>
                Empty — nothing quarantined.
              </div>
            ) : (
              storage.quarantine.map((q) => (
                <div key={q.id} className="install-card">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="setting-row-title">
                      {q.count} map{q.count === 1 ? '' : 's'}
                    </div>
                    <div className="install-sub">
                      {formatRelative(q.createdAt)} · {formatKb(q.bytes / 1024)}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="chrome-btn"
                    onClick={() => void actions.restoreQuarantine(q.id)}
                  >
                    Restore
                  </button>
                </div>
              ))
            )
          ) : null}
          <div className="setting-row">
            <div className="setting-row-text">
              <div className="setting-row-title">Render cache</div>
              <div className="setting-row-sub">
                {storage === null
                  ? '…'
                  : `${formatKb(storage.renderCacheBytes / 1024)} · kept on disk so renders stay viewable offline`}
              </div>
            </div>
            <button type="button" className="chrome-btn" onClick={() => void actions.clearRenderCache()}>
              Clear
            </button>
          </div>
          <div className="setting-row">
            <div className="setting-row-text">
              <div className="setting-row-title">Session cache</div>
              <div className="setting-row-sub">
                The catalog is fetched live — nothing is kept between sessions.
              </div>
            </div>
          </div>
        </div>

        {/* --- Preferences ----------------------------------------------------- */}
        <div className="settings-section">
          <div className="settings-section-title">Preferences</div>
          <div className="setting-row">
            <div className="setting-row-text">
              <div className="setting-row-title">C&C voice-line easter eggs</div>
              <div className="setting-row-sub">“Kirov reporting.” on install · opt-in flavor</div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings?.easterEggs ?? false}
              className={`toggle${settings?.easterEggs ? ' on' : ''}`}
              onClick={() => void actions.updateSettings({ easterEggs: !(settings?.easterEggs ?? false) })}
            >
              <span className="toggle-knob" />
            </button>
          </div>
          <div className="setting-row">
            <div className="setting-row-text">
              <div className="setting-row-title">Reduced motion</div>
              <div className="setting-row-sub">Disables the chronoshift teleport transition</div>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={settings?.reducedMotion ?? false}
              className={`toggle${settings?.reducedMotion ? ' on' : ''}`}
              onClick={() =>
                void actions.updateSettings({ reducedMotion: !(settings?.reducedMotion ?? false) })
              }
            >
              <span className="toggle-knob" />
            </button>
          </div>
          <div className="setting-row">
            <div className="setting-row-text">
              <div className="setting-row-title">Archive server</div>
              {apiEdit === null ? (
                <div className="setting-row-sub mono">{settings?.apiBase ?? ''}</div>
              ) : (
                <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                  <input
                    className="input mono"
                    style={{ fontSize: 12 }}
                    value={apiEdit}
                    onChange={(e) => setApiEdit(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && apiEdit.trim() !== '') {
                        void actions.setApiBase(apiEdit.trim());
                        setApiEdit(null);
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    disabled={apiEdit.trim() === ''}
                    onClick={() => {
                      void actions.setApiBase(apiEdit.trim());
                      setApiEdit(null);
                    }}
                  >
                    Apply
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setApiEdit(null)}>
                    Cancel
                  </button>
                </div>
              )}
            </div>
            {apiEdit === null ? (
              <button
                type="button"
                className="chrome-btn"
                onClick={() => setApiEdit(settings?.apiBase ?? '')}
              >
                Edit
              </button>
            ) : null}
          </div>
        </div>
      </div>
      <div className="modal-footer">
        <div style={{ minWidth: 0 }}>
          <div className="modal-footer-note">
            Chronosphere {version !== null ? `v${version} ` : ''}· The Real Antares
          </div>
          <div className="modal-footer-note" style={{ marginTop: 2 }}>
            Unaffiliated with EA. Maps are player-made scenario files.
          </div>
        </div>
        <div className="modal-footer-spacer" />
        <button type="button" className="link link-dim" onClick={() => actions.replayOnboarding()}>
          Replay first-run
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={checkUpdates}>
          Check for updates
        </button>
      </div>
    </ModalShell>
  );
}
