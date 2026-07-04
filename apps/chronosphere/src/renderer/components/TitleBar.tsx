import { folderTail } from '../lib/format.ts';
import { useAppState, useActions } from '../state/store.tsx';

/**
 * Top bar (screens.md §2.1): brand cluster · sync spinner slot · game-folder
 * switcher (opens Settings) · connection button (retry affordance when
 * offline) · settings gear.
 */
export function TitleBar() {
  const state = useAppState();
  const actions = useActions();

  const folders = state.settings?.gameFolders ?? [];
  const defaultFolder = folders.find((f) => f.isDefault) ?? folders[0];
  const folderValue = defaultFolder ? folderTail(defaultFolder.path) : '—';
  const online = state.connection === 'online';
  const syncing = state.archive.loading || state.archive.loadingMore || state.disk.scanning;

  return (
    <header className="titlebar">
      <div className="brand">
        <span className="brand-pip" aria-hidden="true" />
        <span className="brand-name">Chronosphere</span>
        <span className="brand-eyebrow">// Map Manager</span>
      </div>
      <div className="titlebar-spacer" />
      {syncing ? (
        <span className="sync-spinner" aria-label="Syncing">
          <span className="spin">⟳</span>
        </span>
      ) : null}
      <button
        type="button"
        className="folder-btn"
        onClick={() => actions.openSettingsModal()}
        title={defaultFolder?.path ?? 'Game folder'}
      >
        <span className="folder-btn-label">Game folder</span>
        <span className="folder-btn-value">
          {folderValue}
          {folders.length > 1 ? ` +${folders.length - 1}` : ''}
        </span>
        <span className="folder-btn-chevron">⌄</span>
      </button>
      <button
        type="button"
        className={`conn-btn ${online ? 'online' : 'offline'}`}
        title="Toggle connection"
        onClick={() => {
          if (!online) actions.retryConnection();
        }}
      >
        <span className="conn-dot" aria-hidden="true" />
        {online ? 'Online' : 'Offline'}
      </button>
      <button
        type="button"
        className="icon-btn"
        title="Settings"
        onClick={() => actions.openSettingsModal()}
      >
        ⚙
      </button>
    </header>
  );
}
