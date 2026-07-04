import { formatRelative } from '../lib/format.ts';
import { useAppState, useActions } from '../state/store.tsx';

/** Activity log drawer (screens.md §8): scrim + right panel, capped entries. */
export function ActivityDrawer() {
  const state = useAppState();
  const actions = useActions();
  if (!state.activityDrawerOpen) return null;

  return (
    <>
      <div className="drawer-scrim" onClick={() => actions.closeActivityDrawer()} />
      <aside className="activity-drawer" aria-label="Activity">
        <div className="activity-header">
          <span className="activity-title">Activity</span>
          <button
            type="button"
            className="modal-close"
            aria-label="Close"
            onClick={() => actions.closeActivityDrawer()}
          >
            ✕
          </button>
        </div>
        <div className="activity-list">
          {state.activity.map((entry) => (
            <div key={entry.id} className="activity-entry">
              <span className="activity-glyph">{entry.glyph}</span>
              <span className="activity-text">{entry.text}</span>
              <span className="activity-time">{formatRelative(entry.at)}</span>
            </div>
          ))}
        </div>
      </aside>
    </>
  );
}
