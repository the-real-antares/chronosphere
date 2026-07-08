import { useEffect, useState, type CSSProperties } from 'react';
import { ActivityDrawer } from './components/ActivityDrawer.tsx';
import { useResizable } from './lib/useResizable.ts';
import { StatusBar } from './components/StatusBar.tsx';
import { TitleBar } from './components/TitleBar.tsx';
import { ToastLayer } from './components/ToastLayer.tsx';
import { DetailPanel } from './detail/DetailPanel.tsx';
import { ChronoshiftLayer } from './flows/ChronoshiftLayer.tsx';
import { ContributeModal } from './flows/ContributeModal.tsx';
import { OnboardingFlow } from './flows/OnboardingFlow.tsx';
import { ReviewModal } from './flows/ReviewModal.tsx';
import { SettingsModal } from './flows/SettingsModal.tsx';
import { TidyModal } from './flows/TidyModal.tsx';
import { VersionPickerModal } from './flows/VersionPickerModal.tsx';
import { ArchivePane } from './library/ArchivePane.tsx';
import { DiskPane } from './library/DiskPane.tsx';
import { useActions, useAppState, type Pane } from './state/store.tsx';

/**
 * App shell: title bar · status bar · dual-pane library (narrow: segment
 * tabs) · detail dock · overlays (toasts, activity drawer, modals, flows).
 * Global keyboard map lives here (screens.md §10).
 */

export const NARROW_BREAKPOINT = 1120;

function useIsNarrow(): boolean {
  const [narrow, setNarrow] = useState(() => window.innerWidth < NARROW_BREAKPOINT);
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < NARROW_BREAKPOINT);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return narrow;
}

function useGlobalKeyboard() {
  const state = useAppState();
  const actions = useActions();

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target !== null && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName);

      if (e.key === 'Escape') {
        // Overlays close outer-first: modals → expanded detail → drawer → multi-select.
        if (state.versionPicker.open) return actions.closeVersionPicker();
        if (state.reviewModal.open) return actions.closeReviewModal();
        if (state.contribute.open) return actions.closeContribute();
        if (state.tidy.open) return actions.closeTidy();
        if (state.settingsModalOpen) return actions.closeSettingsModal();
        if (state.detail.tier === 'expanded') return actions.setDetailTier('compact');
        if (state.activityDrawerOpen) return actions.closeActivityDrawer();
        if (state.selection.multi.length > 0) return actions.clearMulti();
        return undefined;
      }
      if (typing) return undefined;
      // Modal steps own their keys (aside from Escape above).
      if (state.reviewModal.open || state.contribute.open || state.tidy.open || state.settingsModalOpen) {
        return undefined;
      }

      switch (e.key) {
        case '/':
          e.preventDefault();
          actions.focusSearch();
          break;
        case 'ArrowDown':
          e.preventDefault();
          actions.moveSelection(1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          actions.moveSelection(-1);
          break;
        case 'Enter':
          actions.invokePrimaryAction();
          break;
        case ' ':
          e.preventDefault();
          actions.toggleMultiOnTarget();
          break;
        default:
          break;
      }
      return undefined;
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [state, actions]);
}

function BootErrorScreen({ message }: { message: string }) {
  return (
    <div className="boot-error">
      <div className="boot-error-glyph">⚠</div>
      <div className="boot-error-title">Chronosphere couldn’t start.</div>
      <div className="boot-error-body">
        Something failed before the library came up. Restart the app; if it keeps happening, this
        is what broke: {message}
      </div>
    </div>
  );
}

/** Persistent auto-update pill: live download % during download, "Restart now" when ready. */
function UpdatePill() {
  const { updateProgress: u } = useAppState();
  if (u.phase === 'idle') return null;
  if (u.phase === 'ready') {
    return (
      <div className="update-pill update-pill-ready">
        <span className="update-pill-icon">✓</span>
        <span>Update v{u.version} ready</span>
        <button
          type="button"
          className="update-pill-btn"
          onClick={() => void window.chrono.updates.quitAndInstall()}
        >
          Restart now
        </button>
      </div>
    );
  }
  return (
    <div className="update-pill">
      <span className="update-pill-icon">↓</span>
      <span>
        Updating v{u.version} · {u.percent}%
      </span>
      <div className="update-pill-bar">
        <div className="update-pill-fill" style={{ width: `${u.percent}%` }} />
      </div>
    </div>
  );
}

function LibraryScreen() {
  const state = useAppState();
  const actions = useActions();
  const narrow = useIsNarrow();
  const [narrowTab, setNarrowTab] = useState<Pane>('archive');
  // Draggable divider between the Archive and Disk panes (wide layout only), persisted.
  const split = useResizable('archiveWidth', 480, { axis: 'x', min: 260, max: 1000 });

  // Status-bar clicks focus the disk pane — follow that into the narrow tab.
  const focusedPane = state.selection.focusedPane;
  useEffect(() => {
    if (narrow) setNarrowTab(focusedPane);
  }, [narrow, focusedPane]);

  const reducedMotion = state.settings?.reducedMotion ?? false;

  return (
    <div className={`app-root${narrow ? ' narrow' : ''}${reducedMotion ? ' reduced-motion' : ''}`}>
      <TitleBar />
      <StatusBar />
      {narrow ? (
        <div className="pane-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={narrowTab === 'archive'}
            className={`seg-tab${narrowTab === 'archive' ? ' active' : ''}`}
            onClick={() => {
              setNarrowTab('archive');
              actions.focusPane('archive');
            }}
          >
            The Archive
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={narrowTab === 'disk'}
            className={`seg-tab${narrowTab === 'disk' ? ' active' : ''}`}
            onClick={() => {
              setNarrowTab('disk');
              actions.focusPane('disk');
            }}
          >
            Your Disk
          </button>
        </div>
      ) : null}
      <div className="app-body">
        <div
          className="app-main"
          style={!narrow ? ({ '--archive-width': `${split.size}px` } as CSSProperties) : undefined}
        >
          {(!narrow || narrowTab === 'archive') && <ArchivePane />}
          {!narrow ? (
            <div
              className="pane-splitter"
              onPointerDown={split.onPointerDown}
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize the map list"
            />
          ) : null}
          {(!narrow || narrowTab === 'disk') && <DiskPane />}
        </div>
        {/* One mount: renders the dock, or the expanded overlay over .app-body. */}
        <DetailPanel />
      </div>

      {/* Overlay surfaces */}
      <ChronoshiftLayer />
      <UpdatePill />
      <ToastLayer />
      <ActivityDrawer />
      <SettingsModal />
      <ContributeModal />
      <TidyModal />
      <ReviewModal />
      <VersionPickerModal />
    </div>
  );
}

export function App() {
  const state = useAppState();
  useGlobalKeyboard();

  if (state.bootError !== null) return <BootErrorScreen message={state.bootError} />;
  if (state.phase === 'booting') {
    return <div className="app-root" aria-busy="true" />;
  }
  if (state.phase === 'onboarding') {
    return (
      <>
        <OnboardingFlow />
        <ToastLayer />
      </>
    );
  }
  return <LibraryScreen />;
}
