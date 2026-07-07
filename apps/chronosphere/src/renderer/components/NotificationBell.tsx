import { useEffect, useRef } from 'react';
import type { NotificationDto } from '@antares/shared/types.ts';
import { formatRelative } from '../lib/format.ts';
import { useStore } from '../state/store.tsx';

/**
 * Title-bar notification bell (phase-3 social layer). Polls the cheap unread
 * count for the badge, opens a dropdown that hydrates the inbox, marks-all-read,
 * and deep-links each row to its map (reusing the store's open-map path). Renders
 * nothing for signed-out visitors so it can sit unconditionally in the chrome.
 *
 * Delivery is in-app only: an Electron OS Notification would need a new
 * main-process IPC channel (out of this stage's scope — main/preload/ipc are
 * owned elsewhere), so new items surface here rather than as a system toast.
 */

const POLL_MS = 60_000;

export function NotificationBell() {
  const { state, actions } = useStore();
  const signedIn = state.session.signedIn;
  const notif = state.notifications;
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Poll the unread count while signed in (the badge); stops when signed out.
  useEffect(() => {
    if (!signedIn) return undefined;
    void actions.pollUnread();
    const id = window.setInterval(() => void actions.pollUnread(), POLL_MS);
    return () => window.clearInterval(id);
  }, [signedIn, actions]);

  // Close on outside click / Esc while the dropdown is open.
  const open = notif.open;
  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) actions.closeNotifications();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') actions.closeNotifications();
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, actions]);

  if (!signedIn) return null;

  const unread = notif.unread;
  const badge = unread > 9 ? '9+' : String(unread);
  const items = notif.items;
  const hasMore = items !== null && items.length < notif.total;

  const anchored = (n: NotificationDto): boolean =>
    n.identitySlug !== undefined && n.identitySlug !== '';

  return (
    <div className="notif-wrap" ref={rootRef}>
      <button
        type="button"
        className="icon-btn notif-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        title="Notifications"
        onClick={() => actions.toggleNotifications()}
      >
        <span aria-hidden="true">🔔</span>
        {unread > 0 ? (
          <span className="notif-badge" aria-hidden="true">
            {badge}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="notif-pop" role="menu" aria-label="Notifications">
          <div className="notif-pop-head">
            <span className="notif-pop-title">Notifications</span>
            <button
              type="button"
              className="link"
              disabled={unread === 0}
              onClick={() => void actions.markAllNotificationsRead()}
            >
              Mark all read
            </button>
          </div>

          {notif.loading && items === null ? (
            <div className="notif-empty">Loading…</div>
          ) : items !== null && items.length > 0 ? (
            <div className="notif-list">
              {items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  role="menuitem"
                  className={`notif-item${n.read ? '' : ' unread'}`}
                  aria-label={anchored(n) ? `${n.title} — open map` : n.title}
                  onClick={() => void actions.openNotification(n)}
                >
                  <div className="notif-item-title">
                    {!n.read ? <span className="notif-dot" aria-hidden="true" /> : null}
                    {n.title}
                  </div>
                  {n.body !== undefined && n.body !== '' ? (
                    <div className="notif-item-body">{n.body}</div>
                  ) : null}
                  <div className="notif-item-meta">
                    {n.actorHandle !== undefined && n.actorHandle !== ''
                      ? `@${n.actorHandle} · `
                      : ''}
                    {formatRelative(n.createdAt)}
                  </div>
                </button>
              ))}
              {hasMore ? (
                <button
                  type="button"
                  className="notif-more"
                  disabled={notif.loading}
                  onClick={() => void actions.loadNotifications(notif.page + 1, true)}
                >
                  {notif.loading ? 'Loading…' : 'Load more'}
                </button>
              ) : null}
            </div>
          ) : (
            <div className="notif-empty">You’re all caught up.</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
