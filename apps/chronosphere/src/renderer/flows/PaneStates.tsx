import { useActions, useAppState } from '../state/store.tsx';

/**
 * Reusable pane states owned by the flows tree:
 * - ConnectionLostState — the archive pane's server-down body + retry
 *   (screens.md §3.4; the disk side keeps working, per spec §10).
 * - NewMapsBanner — the gentle, dismissible "N new maps found" affordance the
 *   disk pane mounts between its filter strip and list (screens.md §4.4).
 */

export function ConnectionLostState() {
  const actions = useActions();
  return (
    <div className="pane-state">
      <div className="pane-state-glyph">⚠</div>
      <div className="pane-state-title">Connection lost</div>
      <div className="pane-state-body">
        The archive lives on the server. Your disk still works — scanning, local previews, and
        cached renders are fine.
      </div>
      <button type="button" className="btn btn-primary" onClick={() => actions.retryConnection()}>
        ⟳ Retry connection
      </button>
    </div>
  );
}

export function NewMapsBanner() {
  const state = useAppState();
  const actions = useActions();
  const n = state.disk.newFound;
  if (n <= 0) return null;
  return (
    <div className="new-maps-banner">
      <span className="new-maps-banner-text">✦ {n} new maps found</span>
      <button type="button" className="link" onClick={() => actions.openContribute()}>
        Review them
      </button>
      <span className="banner-spacer" />
      <button
        type="button"
        className="banner-dismiss"
        aria-label="Dismiss"
        onClick={() => actions.dismissNewFound()}
      >
        ✕
      </button>
    </div>
  );
}
